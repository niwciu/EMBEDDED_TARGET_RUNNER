import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ensureConfigured, hasCMakeCache } from './cmake/configure';
import { selectGenerator } from './cmake/generator';
import { detectTargets } from './cmake/targets';
import { BuildSystem } from './cmake/generator';
import { discoverModules } from './discovery/modules';
import { loadTargets } from './discovery/targets';
import { TargetRunner } from './runner/targetRunner';
import { StateStore } from './state/stateStore';
import { ModuleInfo } from './state/types';
import { DashboardViewProvider, WebviewMessage } from './webview/dashboardView';
import * as fs from 'fs/promises';
import { createConfigureTask } from './tasks/taskFactory';

interface RunnerSettings {
  modulesRoot: string;
  targetsFile: string;
  buildSystem: BuildSystem;
  makeJobs: string | number;
  maxParallel: number;
  excludedModules: string[];
}

interface DashboardControllerOptions {
  modulesRootKey: string;
  moduleLabel: string;
  actionsLabel: string;
  title: string;
  targetsListKey: 'targets' | 'all_test_targets' | 'test' | 'hw' | 'hw_test' | 'ci' | 'reports' | 'format';
  defaultTargets: string[];
}

export class DashboardController implements vscode.Disposable {
  private readonly stateStore = new StateStore();
  private readonly runner: TargetRunner;
  private readonly viewProvider: DashboardViewProvider;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly watchers: vscode.FileSystemWatcher[] = [];
  private readonly options: DashboardControllerOptions;
  private readonly configureTaskNames = new Map<string, string>();
  private readonly configureResolvers = new Map<string, (exitCode?: number) => void>();

  constructor(private readonly context: vscode.ExtensionContext, options: DashboardControllerOptions) {
    this.options = options;
    const settings = this.getSettings();
    this.runner = new TargetRunner(settings.maxParallel);
    this.viewProvider = new DashboardViewProvider(
      context.extensionUri,
      (message) => this.handleWebviewMessage(message),
      options.title,
      options.moduleLabel,
      options.actionsLabel,
    );

    this.disposables.push(
      this.viewProvider,
      this.runner,
      this.configureOutput,
      this.runner.onDidUpdate((update) => {
        if (update.status === 'running') {
          this.stateStore.updateRun(update.moduleId, update.target, { status: 'running', startedAt: Date.now() });
        } else {
          this.stateStore.updateRun(update.moduleId, update.target, {
            status: update.status,
            exitCode: update.exitCode,
            finishedAt: Date.now(),
          });
        }
        this.pushState();
      }),
      vscode.tasks.onDidEndTaskProcess((event) => this.handleConfigureTaskEnd(event)),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('targetsRunner')) {
          this.applySettings();
        }
      }),
    );

    this.refresh();
    this.setupWatchers();
  }

  dispose(): void {
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  async refresh(): Promise<void> {
    const settings = this.getSettings();
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      this.stateStore.setTargets([]);
      this.stateStore.setModules([]);
      this.pushState();
      return;
    }

    const targetLists = await Promise.all(
      folders.map((folder) =>
        loadTargets(folder, settings.targetsFile, this.options.targetsListKey, this.options.defaultTargets),
      ),
    );
    const mergedTargets = this.mergeTargets(targetLists);
    this.stateStore.setTargets(mergedTargets);

    const excluded = new Set(settings.excludedModules);
    const discovered = await Promise.all(
      folders.map((folder) => discoverModules(folder, settings.modulesRoot, excluded)),
    );
    const modules = discovered.flat();
    this.stateStore.setModules(modules);
    this.pushState();

    for (const moduleInfo of modules) {
      await this.refreshModule(moduleInfo, settings);
      this.pushState();
    }
  }

  showDashboard(): void {
    this.viewProvider.show();
    this.pushState();
  }

  runAll(): void {
    const settings = this.getSettings();
    for (const request of this.stateStore.getAllTargets()) {
      this.enqueueRun(request.module, request.target, settings);
    }
  }

  async configureAllModules(): Promise<void> {
    const modules = this.stateStore.getState().modules;
    if (modules.length === 0) {
      return;
    }
    const settings = this.getSettings();
    const selectedSettings = await this.pickGeneratorForAll(settings);
    if (!selectedSettings) {
      return;
    }
    for (const moduleState of modules) {
      await this.removeOutDir(moduleState.module);
      this.stateStore.setNeedsConfigure(moduleState.module.id, true);
    }
    this.pushState();
    for (const moduleState of modules) {
      await this.configureAndDetect(moduleState.module, selectedSettings, false, true);
      this.pushState();
    }
  }

  rerunFailed(): void {
    const settings = this.getSettings();
    for (const request of this.stateStore.getFailedTargets()) {
      this.enqueueRun(request.module, request.target, settings);
    }
  }

  stopAll(): void {
    this.runner.stopAll();
  }

  runTargetForModule(moduleId: string): void {
    const moduleState = this.stateStore.getState().modules.find((state) => state.module.id === moduleId);
    if (!moduleState) {
      return;
    }
    const settings = this.getSettings();
    for (const target of this.stateStore.getState().targets) {
      if (moduleState.availability[target.name]) {
        this.enqueueRun(moduleState.module, target.name, settings);
      }
    }
  }

  runTargetForAllModules(target: string): void {
    const settings = this.getSettings();
    for (const moduleState of this.stateStore.getState().modules) {
      if (moduleState.availability[target]) {
        this.enqueueRun(moduleState.module, target, settings);
      }
    }
  }

  async configureModule(moduleId: string): Promise<void> {
    const moduleState = this.stateStore.getState().modules.find((state) => state.module.id === moduleId);
    if (!moduleState) {
      return;
    }
    const settings = this.getSettings();
    const selectedSettings = await this.pickGeneratorIfNeeded(moduleState.module.name, settings);
    if (!selectedSettings) {
      return;
    }
    await this.configureAndDetect(moduleState.module, selectedSettings, false, true);
    this.pushState();
  }

  async reconfigureModule(moduleId: string): Promise<void> {
    const moduleState = this.stateStore.getState().modules.find((state) => state.module.id === moduleId);
    if (!moduleState) {
      return;
    }
    await this.removeOutDir(moduleState.module);
    this.stateStore.setNeedsConfigure(moduleId, true);
    this.pushState();
    await this.configureModule(moduleId);
  }

  private async refreshModule(moduleInfo: ModuleInfo, settings: RunnerSettings): Promise<void> {
    try {
      if (!(await hasCMakeCache(moduleInfo.path))) {
        this.stateStore.setNeedsConfigure(moduleInfo.id, true);
        this.stateStore.updateConfigure(moduleInfo.id, {
          status: 'idle',
          output: 'Configure required (missing CMake cache).',
          updatedAt: Date.now(),
        });
        for (const target of this.stateStore.getState().targets) {
          this.stateStore.setAvailability(moduleInfo.id, target.name, false);
        }
        return;
      }

      await this.configureAndDetect(moduleInfo, settings, true, false);
    } catch (error) {
      this.stateStore.setNeedsConfigure(moduleInfo.id, true);
      this.stateStore.updateConfigure(moduleInfo.id, {
        status: 'failed',
        output: this.formatConfigureError(error),
        updatedAt: Date.now(),
      });
      for (const target of this.stateStore.getState().targets) {
        this.stateStore.setAvailability(moduleInfo.id, target.name, false);
      }
      console.error(`Failed to refresh module ${moduleInfo.name}`, error);
    }
  }

  private enqueueRun(module: ModuleInfo, target: string, settings: RunnerSettings): void {
    const moduleState = this.stateStore.getModuleState(module.id);
    if (!moduleState || !moduleState.availability[target]) {
      return;
    }
    const generator = moduleState.generator;
    const useNinja = generator ? generator === 'Ninja' : settings.buildSystem !== 'make';
    const makeJobs = settings.makeJobs === 'auto' ? os.cpus().length : settings.makeJobs;
    this.runner.enqueue({
      module,
      target,
      useNinja,
      makeJobs,
    });
  }

  private handleWebviewMessage(message: WebviewMessage): void {
    switch (message.type) {
      case 'refresh':
        void this.refresh();
        break;
      case 'runAll':
        this.runAll();
        break;
      case 'rerunFailed':
        this.rerunFailed();
        break;
      case 'stopAll':
        this.stopAll();
        break;
      case 'runTarget':
        this.enqueueRunById(message.moduleId, message.target);
        break;
      case 'runTargetForModule':
        this.runTargetForModule(message.moduleId);
        break;
      case 'runTargetForAllModules':
        this.runTargetForAllModules(message.target);
        break;
      case 'configureModule':
        void this.configureModule(message.moduleId);
        break;
      case 'reconfigureModule':
        void this.reconfigureModule(message.moduleId);
        break;
      case 'revealConfigure':
        this.revealConfigureOutput(message.moduleId);
        break;
      case 'configureAllModules':
        void this.configureAllModules();
        break;
      case 'reveal':
        this.runner.reveal(message.moduleId, message.target);
        break;
      default:
        break;
    }
  }

  private async configureAndDetect(
    moduleInfo: ModuleInfo,
    settings: RunnerSettings,
    skipConfigure: boolean,
    updateStatus: boolean,
  ): Promise<void> {
    if (updateStatus) {
      this.stateStore.updateConfigure(moduleInfo.id, { status: 'running', updatedAt: Date.now() });
      this.pushState();
    }

    try {
      const generator = await selectGenerator(settings.buildSystem, path.join(moduleInfo.path, 'out'));
      let configureOutput = 'Skipped configure (existing CMake cache).';
      if (!skipConfigure) {
        if (updateStatus) {
          const taskName = `${moduleInfo.name}:configure`;
          this.configureTaskNames.set(moduleInfo.id, taskName);
          const exitCode = await this.runConfigureTask(moduleInfo, generator);
          configureOutput = `See terminal: ${taskName}`;
          if (exitCode && exitCode !== 0) {
            throw new Error(`Configure failed with exit code ${exitCode}.`);
          }
        } else {
          const configureResult = await ensureConfigured(moduleInfo.path, settings.buildSystem);
          configureOutput = configureResult.output;
        }
      }
      this.stateStore.setModuleGenerator(moduleInfo.id, generator);
      this.stateStore.setNeedsConfigure(moduleInfo.id, false);
      if (updateStatus) {
        this.stateStore.updateConfigure(moduleInfo.id, {
          status: 'success',
          output: configureOutput,
          updatedAt: Date.now(),
        });
        this.pushState();
      }
      const targets = await detectTargets(moduleInfo.path, generator);
      for (const target of this.stateStore.getState().targets) {
        this.stateStore.setAvailability(moduleInfo.id, target.name, targets.has(target.name));
      }
    } catch (error) {
      if (updateStatus) {
        this.stateStore.updateConfigure(moduleInfo.id, {
          status: 'failed',
          output: this.formatConfigureError(error),
          updatedAt: Date.now(),
        });
        this.pushState();
      }
      this.stateStore.setNeedsConfigure(moduleInfo.id, true);
      for (const target of this.stateStore.getState().targets) {
        this.stateStore.setAvailability(moduleInfo.id, target.name, false);
      }
      if (!updateStatus) {
        throw error;
      }
    }
  }

  private async pickGeneratorIfNeeded(
    moduleName: string,
    settings: RunnerSettings,
  ): Promise<RunnerSettings | null> {
    if (settings.buildSystem !== 'auto') {
      return settings;
    }
    const selection = await vscode.window.showQuickPick(
      [
        { label: 'Ninja', description: 'Fast builds with Ninja' },
        { label: 'Unix Makefiles', description: 'Use Makefiles' },
      ],
      {
        placeHolder: `Select CMake generator for ${moduleName}`,
      },
    );
    if (selection?.label === 'Ninja') {
      return { ...settings, buildSystem: 'ninja' };
    }
    if (selection?.label === 'Unix Makefiles') {
      return { ...settings, buildSystem: 'make' };
    }
    return null;
  }

  private async pickGeneratorForAll(settings: RunnerSettings): Promise<RunnerSettings | null> {
    if (settings.buildSystem !== 'auto') {
      return settings;
    }
    const selection = await vscode.window.showQuickPick(
      [
        { label: 'Ninja', description: 'Fast builds with Ninja' },
        { label: 'Unix Makefiles', description: 'Use Makefiles' },
      ],
      {
        placeHolder: 'Select CMake generator for all modules',
      },
    );
    if (selection?.label === 'Ninja') {
      return { ...settings, buildSystem: 'ninja' };
    }
    if (selection?.label === 'Unix Makefiles') {
      return { ...settings, buildSystem: 'make' };
    }
    return null;
  }

  private async removeOutDir(module: ModuleInfo): Promise<void> {
    const outDir = path.join(module.path, 'out');
    try {
      await fs.rm(outDir, { recursive: true, force: true });
    } catch (error) {
      console.error(`Failed to remove out/ for ${module.name}`, error);
    }
  }

  private enqueueRunById(moduleId: string, target: string): void {
    const moduleState = this.stateStore.getState().modules.find((state) => state.module.id === moduleId);
    if (!moduleState) {
      return;
    }
    this.enqueueRun(moduleState.module, target, this.getSettings());
  }

  private revealConfigureOutput(moduleId: string): void {
    const moduleState = this.stateStore.getState().modules.find((state) => state.module.id === moduleId);
    if (!moduleState) {
      return;
    }
    const taskName = this.configureTaskNames.get(moduleId) ?? `${moduleState.module.name}:configure`;
    const terminal = vscode.window.terminals.find((item) => item.name === taskName);
    if (terminal) {
      terminal.show(true);
      return;
    }
    vscode.window.showInformationMessage(
      moduleState.configure?.output ?? 'No configure terminal found for this module yet.',
    );
  }

  private async runConfigureTask(moduleInfo: ModuleInfo, generator: string): Promise<number | undefined> {
    const task = createConfigureTask(moduleInfo, generator);
    await vscode.tasks.executeTask(task);
    return new Promise((resolve) => {
      this.configureResolvers.set(moduleInfo.id, resolve);
    });
  }

  private handleConfigureTaskEnd(event: vscode.TaskProcessEndEvent): void {
    const definition = event.execution.task.definition as { type?: string; moduleId?: string };
    if (definition?.type !== 'targetsRunnerConfigure' || !definition.moduleId) {
      return;
    }
    const resolver = this.configureResolvers.get(definition.moduleId);
    if (resolver) {
      this.configureResolvers.delete(definition.moduleId);
      resolver(event.exitCode);
    }
  }

  private formatConfigureError(error: unknown): string {
    if (error && typeof error === 'object' && 'stdout' in error && 'stderr' in error) {
      const stdout =
        typeof error.stdout === 'string'
          ? error.stdout
          : Buffer.isBuffer(error.stdout)
            ? error.stdout.toString()
            : '';
      const stderr =
        typeof error.stderr === 'string'
          ? error.stderr
          : Buffer.isBuffer(error.stderr)
            ? error.stderr.toString()
            : '';
      const code = 'code' in error ? `Exit code: ${String(error.code)}` : '';
      const message = 'message' in error && typeof error.message === 'string' ? error.message : 'Configure failed.';
      return [message, code, stdout, stderr].filter(Boolean).join('\n');
    }
    if (error instanceof Error) {
      return error.message;
    }
    return 'Configure failed.';
  }

  private mergeTargets(targetLists: Array<{ name: string }[]>): Array<{ name: string }> {
    const merged: Array<{ name: string }> = [];
    const seen = new Set<string>();
    for (const list of targetLists) {
      for (const target of list) {
        if (seen.has(target.name)) {
          continue;
        }
        seen.add(target.name);
        merged.push(target);
      }
    }
    return merged;
  }

  private pushState(): void {
    this.viewProvider.setState(this.stateStore.getState());
  }

  private setupWatchers(): void {
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers.length = 0;

    const settings = this.getSettings();
    const folders = vscode.workspace.workspaceFolders ?? [];
    for (const folder of folders) {
      const pattern = new vscode.RelativePattern(folder, settings.targetsFile);
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      watcher.onDidChange(() => this.refresh());
      watcher.onDidCreate(() => this.refresh());
      watcher.onDidDelete(() => this.refresh());
      this.watchers.push(watcher);
    }
  }

  private applySettings(): void {
    const settings = this.getSettings();
    this.runner.setMaxParallel(settings.maxParallel);
    this.setupWatchers();
    void this.refresh();
  }

  private getSettings(): RunnerSettings {
    const config = vscode.workspace.getConfiguration('targetsRunner');
    return {
      modulesRoot: config.get<string>(this.options.modulesRootKey, config.get<string>('modulesRoot', 'test')),
      targetsFile: config.get<string>('targetsFile', 'epm_targets_lists.json'),
      buildSystem: config.get<BuildSystem>('buildSystem', 'auto'),
      makeJobs: config.get<string | number>('makeJobs', 'auto'),
      maxParallel: config.get<number>('maxParallel', 4),
      excludedModules: config.get<string[]>('excludedModules', [
        'unity',
        'cmock',
        'CMock',
        'Cmock',
        'Unity',
        'template',
      ]),
    };
  }
}
