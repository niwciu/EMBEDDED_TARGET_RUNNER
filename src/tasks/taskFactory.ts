import * as path from 'path';
import * as vscode from 'vscode';
import { ModuleInfo } from '../state/types';

export interface TargetTaskDefinition extends vscode.TaskDefinition {
  type: 'targetsRunner';
  moduleId: string;
  target: string;
}

export function createTargetTask(
  moduleInfo: ModuleInfo,
  target: string,
  useNinja: boolean,
  makeJobs: string | number,
): vscode.Task {
  const cwd = path.join(moduleInfo.path, 'out');
  const command = useNinja ? 'ninja' : 'make';
  const args: string[] = [];
  if (!useNinja) {
    const jobs = makeJobs === 'auto' ? undefined : makeJobs;
    if (jobs) {
      args.push(`-j${jobs}`);
    }
  }
  args.push(target);

  const execution = new vscode.ShellExecution(command, args, { cwd });

  const definition: TargetTaskDefinition = {
    type: 'targetsRunner',
    moduleId: moduleInfo.id,
    target,
  };

  const task = new vscode.Task(
    definition,
    moduleInfo.workspaceFolder,
    `${moduleInfo.name}:${target}`,
    'targetsRunner',
    execution,
    ['$gcc'],
  );

  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Never,
    panel: vscode.TaskPanelKind.Dedicated,
    clear: false,
    focus: false,
  };

  return task;
}
