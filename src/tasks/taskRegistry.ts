import * as vscode from 'vscode';

const registeredTaskNames = new Set<string>();

export function registerTaskName(name: string): void {
  registeredTaskNames.add(name);
}

export async function clearRegisteredTaskTerminals(options?: { closeAllTerminals?: boolean }): Promise<void> {
  if (options?.closeAllTerminals) {
    await vscode.commands.executeCommand('workbench.action.terminal.closeAll');
    registeredTaskNames.clear();
    return;
  }
  if (registeredTaskNames.size === 0) {
    return;
  }
  const terminals = vscode.window.terminals;
  const hasNonRegistered = terminals.some((terminal) => !registeredTaskNames.has(terminal.name));
  if (!hasNonRegistered) {
    await vscode.commands.executeCommand('workbench.action.terminal.closeAll');
  } else {
    for (const terminal of terminals) {
      if (registeredTaskNames.has(terminal.name)) {
        terminal.dispose();
      }
    }
  }
  registeredTaskNames.clear();
}

export function terminateAllRunnerTasks(): void {
  for (const execution of vscode.tasks.taskExecutions) {
    const definition = execution.task.definition as { type?: string };
    if (definition?.type === 'targetsManager' || definition?.type === 'targetsManagerConfigure') {
      execution.terminate();
    }
  }
}
