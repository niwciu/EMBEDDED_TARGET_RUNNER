import * as vscode from 'vscode';
import { DashboardController } from './dashboardController';
import { MenuViewProvider } from './menu/menuView';
import { DEFAULT_ALL_TEST_TARGETS, DEFAULT_HW_TARGETS } from './discovery/targets';

let testController: DashboardController | undefined;
let hwController: DashboardController | undefined;

export function activate(context: vscode.ExtensionContext): void {
  testController = new DashboardController(context, {
    modulesRootKey: 'testModulesRoot',
    moduleLabel: 'Module Name',
    actionsLabel: 'Module Actions',
    title: 'Targets Dashboard',
    targetsListKey: 'all_test_targets',
    defaultTargets: DEFAULT_ALL_TEST_TARGETS,
  });
  hwController = new DashboardController(context, {
    modulesRootKey: 'hwConfigurationsRoot',
    moduleLabel: 'HW configuration',
    actionsLabel: 'Actions',
    title: 'HW Targets Dashboard',
    targetsListKey: 'hw',
    defaultTargets: DEFAULT_HW_TARGETS,
  });
  const menuViewProvider = new MenuViewProvider();

  context.subscriptions.push(
    testController,
    hwController,
    menuViewProvider,
    vscode.window.registerTreeDataProvider('targetsRunner.menu', menuViewProvider),
    vscode.commands.registerCommand('targetsRunner.refresh', () => testController?.refresh()),
    vscode.commands.registerCommand('targetsRunner.runAll', () => testController?.runAll()),
    vscode.commands.registerCommand('targetsRunner.rerunFailed', () => testController?.rerunFailed()),
    vscode.commands.registerCommand('targetsRunner.stopAll', () => testController?.stopAll()),
    vscode.commands.registerCommand('targetsRunner.runTargetForModule', (moduleId: string) =>
      testController?.runTargetForModule(moduleId),
    ),
    vscode.commands.registerCommand('targetsRunner.runTargetForAllModules', (target: string) =>
      testController?.runTargetForAllModules(target),
    ),
    vscode.commands.registerCommand('targetsRunner.openDashboard', () => testController?.showDashboard()),
    vscode.commands.registerCommand('targetsRunner.openHwDashboard', () => hwController?.showDashboard()),
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
  testController?.dispose();
  hwController?.dispose();
}
