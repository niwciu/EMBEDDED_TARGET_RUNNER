import * as vscode from 'vscode';

const registeredTaskNames = new Set<string>();

export function registerTaskName(name: string): void {
  registeredTaskNames.add(name);
}

export function clearRegisteredTaskTerminals(): void {
  if (registeredTaskNames.size === 0) {
    return;
  }
  for (const terminal of vscode.window.terminals) {
    if (registeredTaskNames.has(terminal.name)) {
      terminal.dispose();
    }
  }
  registeredTaskNames.clear();
}

export function terminateAllRunnerTasks(): void {
  for (const execution of vscode.tasks.taskExecutions) {
    const definition = execution.task.definition as { type?: string };
    if (definition?.type === 'targetsRunner' || definition?.type === 'targetsRunnerConfigure') {
      execution.terminate();
    }
  }
}
