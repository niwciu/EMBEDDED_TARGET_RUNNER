import * as vscode from 'vscode';
import { ModuleInfo } from '../state/types';
import { createTargetTask } from '../tasks/taskFactory';

export interface RunUpdate {
  moduleId: string;
  target: string;
  status: 'running' | 'success' | 'failed';
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
  private readonly lastTerminal = new Map<string, vscode.Terminal>();
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
    this.pending.push(request);
    this.kick();
  }

  reveal(moduleId: string, target: string): void {
    const key = this.getKey(moduleId, target);
    const running = this.running.get(key);
    if (running?.terminal) {
      running.terminal.show(true);
      return;
    }
    const terminal = this.lastTerminal.get(key);
    if (terminal) {
      terminal.show(true);
    }
  }

  stopAll(): void {
    for (const execution of this.running.values()) {
      execution.terminate();
    }
    this.pending.length = 0;
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

    const execution = await vscode.tasks.executeTask(task);
    this.running.set(key, execution);
    if (execution.terminal) {
      this.lastTerminal.set(key, execution.terminal);
    }
  }

  private handleTaskEnd(event: vscode.TaskProcessEndEvent): void {
    const definition = event.execution.task.definition as { type?: string; moduleId?: string; target?: string };
    if (definition?.type !== 'targetsRunner' || !definition.moduleId || !definition.target) {
      return;
    }
    const key = this.getKey(definition.moduleId, definition.target);
    this.running.delete(key);
    const status: RunUpdate['status'] = event.exitCode === 0 ? 'success' : 'failed';
    this.updates.fire({ moduleId: definition.moduleId, target: definition.target, status, exitCode: event.exitCode });
    this.kick();
  }

  private getKey(moduleId: string, target: string): string {
    return `${moduleId}:${target}`;
  }
}
