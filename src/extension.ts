import * as vscode from 'vscode';
import { DashboardController } from './dashboardController';
import { MenuViewProvider } from './menu/menuView';

let controller: DashboardController | undefined;

export function activate(context: vscode.ExtensionContext): void {
  controller = new DashboardController(context);
  const menuViewProvider = new MenuViewProvider();

  context.subscriptions.push(
    controller,
    menuViewProvider,
    vscode.window.registerTreeDataProvider('targetsRunner.menu', menuViewProvider),
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
    vscode.commands.registerCommand('targetsRunner.openDashboard', () => controller?.showDashboard()),
    vscode.commands.registerCommand('targetsRunner.menuAction', async (action: string) => {
      const label = action
        ? action
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, (value) => value.toUpperCase())
            .trim()
        : 'Action';
      await vscode.window.showInformationMessage(`"${label}" is not implemented yet.`);
    }),
  );
}

export function deactivate(): void {
  controller?.dispose();
}
