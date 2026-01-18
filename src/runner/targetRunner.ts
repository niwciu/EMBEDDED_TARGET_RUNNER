import * as path from 'path';
import * as vscode from 'vscode';
import { ModuleInfo } from '../state/types';
import { createTargetTask, getTargetCommand } from '../tasks/taskFactory';
import { clearRegisteredTaskTerminals } from '../tasks/taskRegistry';
import { runCommandWithExitCode } from '../utils/exec';

export interface RunUpdate {
  moduleId: string;
  target: string;
  status: 'running' | 'success' | 'warning' | 'failed';
  exitCode?: number;
}

export interface RunRequest {
  module: ModuleInfo;
  target: string;
  useNinja: boolean;
  makeJobs: string | number;
  autoCloseOnSuccess: boolean;
  runInTerminal?: boolean;
}

type RunningEntry = { kind: 'task'; execution: vscode.TaskExecution } | { kind: 'silent' };

export class TargetRunner implements vscode.Disposable {
  private readonly pending: RunRequest[] = [];
  private readonly running = new Map<string, RunningEntry>();
  private readonly taskNames = new Map<string, string>();
  private readonly modulePaths = new Map<string, string>();
  private readonly runStartedAt = new Map<string, number>();
  private readonly autoCloseOnSuccess = new Map<string, boolean>();
  private readonly taskOutput = new Map<string, string>();
  private readonly updates = new vscode.EventEmitter<RunUpdate>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly maxOutputSize = 200_000;

  constructor(private maxParallel: number) {
    const tasksAny = vscode.tasks as typeof vscode.tasks & {
      onDidWriteTaskData?: (listener: (event: unknown) => void) => vscode.Disposable;
    };
    this.disposables.push(
      vscode.tasks.onDidEndTaskProcess((event) => {
        void this.handleTaskEnd(event);
      }),
      tasksAny.onDidWriteTaskData
        ? tasksAny.onDidWriteTaskData((event) => {
            this.handleTaskOutput(event);
          })
        : { dispose: () => undefined },
      this.updates,
    );
  }

  get onDidUpdate(): vscode.Event<RunUpdate> {
    return this.updates.event;
  }

  setMaxParallel(maxParallel: number): void {
    this.maxParallel = maxParallel;
    this.kick();
  }

  enqueue(request: RunRequest): void {
    const key = this.getKey(request.module.id, request.target);
    if (this.running.has(key) || this.pending.some((item) => this.getKey(item.module.id, item.target) === key)) {
      return;
    }
    this.taskNames.set(key, this.getTaskName(request.module.name, request.target));
    this.autoCloseOnSuccess.set(key, request.autoCloseOnSuccess);
    this.pending.push(request);
    this.kick();
  }

  stopAll(): void {
    for (const entry of this.running.values()) {
      if (entry.kind === 'task') {
        entry.execution.terminate();
      }
    }
    this.pending.length = 0;
  }

  async clearAllTerminals(options?: { closeAllTerminals?: boolean }): Promise<void> {
    await clearRegisteredTaskTerminals(options);
    this.taskNames.clear();
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private kick(): void {
    while (this.running.size < this.maxParallel && this.pending.length > 0) {
      const request = this.pending.shift();
      if (!request) {
        break;
      }
      this.execute(request);
    }
  }

  private async execute(request: RunRequest): Promise<void> {
    const key = this.getKey(request.module.id, request.target);
    this.updates.fire({ moduleId: request.module.id, target: request.target, status: 'running' });
    this.modulePaths.set(key, request.module.path);
    this.runStartedAt.set(key, Date.now());
    this.taskOutput.set(key, '');
    if (request.runInTerminal === false) {
      this.running.set(key, { kind: 'silent' });
      await this.executeSilently(request, key);
      return;
    }

    await this.executeInTerminal(request, key);
  }

  private async handleTaskEnd(event: vscode.TaskProcessEndEvent): Promise<void> {
    const definition = event.execution.task.definition as { type?: string; moduleId?: string; target?: string };
    if (definition?.type !== 'targetsManager' || !definition.moduleId || !definition.target) {
      return;
    }
    const key = this.getKey(definition.moduleId, definition.target);
    this.running.delete(key);
    const modulePath = this.modulePaths.get(key);
    const startedAt = this.runStartedAt.get(key) ?? Date.now();
    const output = this.taskOutput.get(key) ?? '';
    let status: RunUpdate['status'] = event.exitCode === 0 ? 'success' : 'failed';
    if (status === 'success' && modulePath) {
      status = await this.resolveDiagnosticsStatus(modulePath, startedAt);
    }
    if (status === 'success' && output) {
      status = this.resolveOutputStatus(0, output);
    }
    if (status === 'success' && this.autoCloseOnSuccess.get(key)) {
      this.closeTaskTerminal(key);
    }
    this.updates.fire({
      moduleId: definition.moduleId,
      target: definition.target,
      status,
      exitCode: event.exitCode,
    });
    this.modulePaths.delete(key);
    this.runStartedAt.delete(key);
    this.autoCloseOnSuccess.delete(key);
    this.taskOutput.delete(key);
    this.kick();
  }

  private getKey(moduleId: string, target: string): string {
    return `${moduleId}:${target}`;
  }

  private getTaskName(moduleName: string, target: string): string {
    return `${moduleName}:${target}`;
  }

  private handleTaskOutput(event: unknown): void {
    if (!event || typeof event !== 'object' || !('execution' in event) || !('data' in event)) {
      return;
    }
    const { execution, data } = event as { execution: vscode.TaskExecution; data: string };
    const definition = execution.task.definition as { type?: string; moduleId?: string; target?: string };
    if (definition?.type !== 'targetsManager' || !definition.moduleId || !definition.target) {
      return;
    }
    const key = this.getKey(definition.moduleId, definition.target);
    const existing = this.taskOutput.get(key) ?? '';
    let next = existing + data;
    if (next.length > this.maxOutputSize) {
      next = next.slice(next.length - this.maxOutputSize);
    }
    this.taskOutput.set(key, next);
  }

  private closeTaskTerminal(key: string): void {
    const taskName = this.taskNames.get(key);
    if (!taskName) {
      return;
    }
    const terminal = vscode.window.terminals.find((item) => item.name === taskName);
    terminal?.dispose();
  }

  private async executeInTerminal(request: RunRequest, key: string): Promise<void> {
    this.taskOutput.set(key, '');
    const task = createTargetTask(request.module, request.target, request.useNinja, request.makeJobs);
    const execution = await vscode.tasks.executeTask(task);
    this.running.set(key, { kind: 'task', execution });
  }

  private async executeSilently(request: RunRequest, key: string): Promise<void> {
    const { command, args, cwd } = getTargetCommand(request.module, request.target, request.useNinja, request.makeJobs);
    const result = await runCommandWithExitCode(command, args, cwd);
    const output = `${result.stdout}\n${result.stderr}`.trim();
    const status = this.resolveOutputStatus(result.exitCode ?? 1, output);
    if (status === 'success') {
      this.running.delete(key);
      this.updates.fire({
        moduleId: request.module.id,
        target: request.target,
        status,
        exitCode: result.exitCode ?? 0,
      });
      this.modulePaths.delete(key);
      this.runStartedAt.delete(key);
      this.autoCloseOnSuccess.delete(key);
      this.kick();
      return;
    }
    this.running.delete(key);
    this.autoCloseOnSuccess.set(key, false);
    this.runStartedAt.set(key, Date.now());
    this.updates.fire({ moduleId: request.module.id, target: request.target, status: 'running' });
    await this.executeInTerminal({ ...request, runInTerminal: true }, key);
  }

  private resolveOutputStatus(exitCode: number, output: string): RunUpdate['status'] {
    if (exitCode !== 0) {
      return 'failed';
    }
    if (!output) {
      return 'success';
    }
    const warningPattern = /(^|\s)warning\s*:/im;
    const errorPattern = /(^|\s)(fatal\s+)?error\s*:/im;
    if (errorPattern.test(output)) {
      return 'failed';
    }
    if (warningPattern.test(output)) {
      return 'warning';
    }
    return 'success';
  }

  private getDiagnosticsCounts(modulePath: string): { warnings: number; errors: number } {
    const moduleRoot = path.resolve(modulePath);
    const modulePrefix = moduleRoot.endsWith(path.sep) ? moduleRoot : moduleRoot + path.sep;
    let warnings = 0;
    let errors = 0;
    for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
      const fsPath = uri.fsPath;
      if (!fsPath) {
        continue;
      }
      const normalized = path.resolve(fsPath);
      if (normalized !== moduleRoot && !normalized.startsWith(modulePrefix)) {
        continue;
      }
      for (const diagnostic of diagnostics) {
        if (diagnostic.severity === vscode.DiagnosticSeverity.Warning) {
          warnings += 1;
        } else if (diagnostic.severity === vscode.DiagnosticSeverity.Error) {
          errors += 1;
        }
      }
    }
    return { warnings, errors };
  }

  private async resolveDiagnosticsStatus(modulePath: string, startedAt: number): Promise<RunUpdate['status']> {
    await this.waitForDiagnosticsSettled(modulePath, startedAt);
    const current = this.getDiagnosticsCounts(modulePath);
    if (current.errors > 0) {
      return 'failed';
    }
    if (current.warnings > 0) {
      return 'warning';
    }
    return 'success';
  }

  private waitForDiagnosticsSettled(modulePath: string, startedAt: number): Promise<void> {
    const moduleRoot = path.resolve(modulePath);
    const modulePrefix = moduleRoot.endsWith(path.sep) ? moduleRoot : moduleRoot + path.sep;
    const initialWaitMs = 1000;
    const quietWindowMs = 300;
    const maxWaitMs = 5000;
    let quietTimeout: NodeJS.Timeout | undefined;
    let maxTimeout: NodeJS.Timeout | undefined;
    let initialTimeout: NodeJS.Timeout | undefined;
    let resolvePromise: () => void;
    let sawChange = false;
    const promise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
    let disposableIndex = -1;
    const cleanup = () => {
      if (quietTimeout) {
        clearTimeout(quietTimeout);
      }
      if (maxTimeout) {
        clearTimeout(maxTimeout);
      }
      if (initialTimeout) {
        clearTimeout(initialTimeout);
      }
      if (disposableIndex !== -1) {
        this.disposables.splice(disposableIndex, 1);
        disposableIndex = -1;
      }
      disposable.dispose();
      resolvePromise();
    };
    const bumpQuietTimer = () => {
      if (quietTimeout) {
        clearTimeout(quietTimeout);
      }
      quietTimeout = setTimeout(() => {
        cleanup();
      }, quietWindowMs);
    };
    const disposable = vscode.languages.onDidChangeDiagnostics((event) => {
      for (const uri of event.uris) {
        const fsPath = uri.fsPath;
        if (!fsPath) {
          continue;
        }
        const normalized = path.resolve(fsPath);
        if (normalized === moduleRoot || normalized.startsWith(modulePrefix)) {
          sawChange = true;
          if (Date.now() >= startedAt) {
            bumpQuietTimer();
          }
          break;
        }
      }
    });
    this.disposables.push(disposable);
    disposableIndex = this.disposables.length - 1;
    initialTimeout = setTimeout(() => {
      if (!sawChange) {
        cleanup();
      }
    }, initialWaitMs);
    maxTimeout = setTimeout(() => {
      cleanup();
    }, maxWaitMs);
    return promise;
  }
}
