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
}

export class TargetRunner implements vscode.Disposable {
  private readonly pending: RunRequest[] = [];
  private readonly running = new Map<string, vscode.TaskExecution>();
  private readonly taskNames = new Map<string, string>();
  private readonly modulePaths = new Map<string, string>();
  private readonly runDiagnostics = new Map<
    string,
    { warnings: boolean; errors: boolean; modulePath: string; disposable: vscode.Disposable }
  >();
  private readonly updates = new vscode.EventEmitter<RunUpdate>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private maxParallel: number) {
    this.disposables.push(
      vscode.tasks.onDidEndTaskProcess((event) => this.handleTaskEnd(event)),
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
    this.pending.push(request);
    this.kick();
  }

  reveal(moduleId: string, target: string): void {
    const key = this.getKey(moduleId, target);
    const taskName = this.taskNames.get(key);
    if (!taskName) {
      return;
    }
    const terminal = vscode.window.terminals.find((item) => item.name === taskName);
    terminal?.show(true);
  }

  stopAll(): void {
    for (const execution of this.running.values()) {
      execution.terminate();
    }
    this.pending.length = 0;
  }

  clearAllTerminals(): void {
    clearRegisteredTaskTerminals();
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
    this.runDiagnostics.set(key, this.createDiagnosticsTracker(request.module.path));

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
    let status: RunUpdate['status'] = event.exitCode === 0 ? 'success' : 'failed';
    if (status === 'success') {
      const modulePath = this.modulePaths.get(key);
      const tracker = this.runDiagnostics.get(key);
      if (modulePath && tracker) {
        await this.waitForDiagnostics(modulePath, 750);
        if (tracker.errors) {
          status = 'failed';
        } else if (tracker.warnings) {
          status = 'warning';
        }
      }
    }
    this.updates.fire({ moduleId: definition.moduleId, target: definition.target, status, exitCode: event.exitCode });
    this.runDiagnostics.get(key)?.disposable.dispose();
    this.runDiagnostics.delete(key);
    this.modulePaths.delete(key);
    this.kick();
  }

  private getKey(moduleId: string, target: string): string {
    return `${moduleId}:${target}`;
  }

  private getTaskName(moduleName: string, target: string): string {
    return `${moduleName}:${target}`;
  }

  private waitForDiagnostics(modulePath: string, timeoutMs: number): Promise<void> {
    const moduleRoot = path.resolve(modulePath);
    const modulePrefix = moduleRoot.endsWith(path.sep) ? moduleRoot : moduleRoot + path.sep;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        disposable.dispose();
        resolve();
      }, timeoutMs);
      const disposable = vscode.languages.onDidChangeDiagnostics((event) => {
        const touched = event.uris.some((uri) => {
          const fsPath = uri.fsPath;
          if (!fsPath) {
            return false;
          }
          const normalized = path.resolve(fsPath);
          return normalized === moduleRoot || normalized.startsWith(modulePrefix);
        });
        if (touched) {
          clearTimeout(timeout);
          disposable.dispose();
          resolve();
        }
      });
    });
  }

  private createDiagnosticsTracker(modulePath: string): {
    warnings: boolean;
    errors: boolean;
    modulePath: string;
    disposable: vscode.Disposable;
  } {
    const moduleRoot = path.resolve(modulePath);
    const modulePrefix = moduleRoot.endsWith(path.sep) ? moduleRoot : moduleRoot + path.sep;
    const tracker = {
      warnings: false,
      errors: false,
      modulePath,
      disposable: vscode.languages.onDidChangeDiagnostics((event) => {
        const relevant = event.uris.filter((uri) => {
          const fsPath = uri.fsPath;
          if (!fsPath) {
            return false;
          }
          const normalized = path.resolve(fsPath);
          return normalized === moduleRoot || normalized.startsWith(modulePrefix);
        });
        if (relevant.length === 0) {
          return;
        }
        for (const uri of relevant) {
          const diagnostics = vscode.languages.getDiagnostics(uri);
          for (const diagnostic of diagnostics) {
            if (diagnostic.severity === vscode.DiagnosticSeverity.Error) {
              tracker.errors = true;
            } else if (diagnostic.severity === vscode.DiagnosticSeverity.Warning) {
              tracker.warnings = true;
            }
          }
        }
      }),
    };
    return tracker;
  }
}
