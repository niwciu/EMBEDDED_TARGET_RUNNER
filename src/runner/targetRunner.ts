import * as path from 'path';
import * as vscode from 'vscode';
import { ModuleInfo } from '../state/types';
import { createTargetTask } from '../tasks/taskFactory';
import { clearRegisteredTaskTerminals } from '../tasks/taskRegistry';

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
}

export class TargetRunner implements vscode.Disposable {
  private readonly pending: RunRequest[] = [];
  private readonly running = new Map<string, vscode.TaskExecution>();
  private readonly taskNames = new Map<string, string>();
  private readonly modulePaths = new Map<string, string>();
  private readonly runStartedAt = new Map<string, number>();
  private readonly autoCloseOnSuccess = new Map<string, boolean>();
  private readonly updates = new vscode.EventEmitter<RunUpdate>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private maxParallel: number) {
    this.disposables.push(
      vscode.tasks.onDidEndTaskProcess((event) => {
        void this.handleTaskEnd(event);
      }),
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
    for (const execution of this.running.values()) {
      execution.terminate();
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
    const task = createTargetTask(request.module, request.target, request.useNinja, request.makeJobs);
    this.updates.fire({ moduleId: request.module.id, target: request.target, status: 'running' });
    this.modulePaths.set(key, request.module.path);
    this.runStartedAt.set(key, Date.now());

    const execution = await vscode.tasks.executeTask(task);
    this.running.set(key, execution);
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
    let status: RunUpdate['status'] = event.exitCode === 0 ? 'success' : 'failed';
    if (status === 'success' && modulePath) {
      status = await this.resolveDiagnosticsStatus(modulePath, startedAt);
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
    this.kick();
  }

  private getKey(moduleId: string, target: string): string {
    return `${moduleId}:${target}`;
  }

  private getTaskName(moduleName: string, target: string): string {
    return `${moduleName}:${target}`;
  }

  private closeTaskTerminal(key: string): void {
    const taskName = this.taskNames.get(key);
    if (!taskName) {
      return;
    }
    const terminal = vscode.window.terminals.find((item) => item.name === taskName);
    terminal?.dispose();
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
