import * as vscode from 'vscode';
import { DashboardController } from './dashboardController';

let controller: DashboardController | undefined;

export function activate(context: vscode.ExtensionContext): void {
  controller = new DashboardController(context);

  context.subscriptions.push(
    controller,
    vscode.commands.registerCommand('targetsRunner.refresh', () => controller?.refresh()),
    vscode.commands.registerCommand('targetsRunner.runAll', () => controller?.runAll()),
    vscode.commands.registerCommand('targetsRunner.rerunFailed', () => controller?.rerunFailed()),
    vscode.commands.registerCommand('targetsRunner.stopAll', () => controller?.stopAll()),
    vscode.commands.registerCommand('targetsRunner.runTargetForModule', (moduleId: string) =>
      controller?.runTargetForModule(moduleId),
    ),
    vscode.commands.registerCommand('targetsRunner.runTargetForAllModules', (target: string) =>
      controller?.runTargetForAllModules(target),
    ),
  );
}

export function deactivate(): void {
  controller?.dispose();
}
