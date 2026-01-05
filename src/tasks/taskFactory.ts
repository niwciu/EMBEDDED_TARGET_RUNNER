import * as path from 'path';
import * as vscode from 'vscode';
import { ModuleInfo } from '../state/types';
import { registerTaskName } from './taskRegistry';

export interface TargetTaskDefinition extends vscode.TaskDefinition {
  type: 'targetsRunner';
  moduleId: string;
  target: string;
}

export interface ConfigureTaskDefinition extends vscode.TaskDefinition {
  type: 'targetsRunnerConfigure';
  moduleId: string;
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

  const taskName = `${moduleInfo.name}:${target}`;
  const task = new vscode.Task(
    definition,
    moduleInfo.workspaceFolder,
    taskName,
    'targetsRunner',
    execution,
    ['$gcc'],
  );

  registerTaskName(taskName);
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Never,
    panel: vscode.TaskPanelKind.Dedicated,
    clear: false,
    focus: false,
  };

  return task;
}

export function createConfigureTask(moduleInfo: ModuleInfo, generator: string): vscode.Task {
  const execution = new vscode.ShellExecution('cmake', ['-S', './', '-B', 'out', '-G', generator], {
    cwd: moduleInfo.path,
  });

  const definition: ConfigureTaskDefinition = {
    type: 'targetsRunnerConfigure',
    moduleId: moduleInfo.id,
  };

  const taskName = `${moduleInfo.name}:configure`;
  const task = new vscode.Task(
    definition,
    moduleInfo.workspaceFolder,
    taskName,
    'targetsRunner',
    execution,
    ['$gcc'],
  );

  registerTaskName(taskName);
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Never,
    panel: vscode.TaskPanelKind.Dedicated,
    clear: false,
    focus: false,
  };

  return task;
}
