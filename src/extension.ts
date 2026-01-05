import * as vscode from 'vscode';
import { DashboardController, DashboardDefinition } from './dashboardController';
import { MenuViewProvider } from './menu/menuView';
import { DEFAULT_ALL_TEST_TARGETS } from './discovery/targets';
import { SettingsViewProvider, SettingsState } from './webview/settingsView';

let dashboardControllers: DashboardController[] = [];
let activeController: DashboardController | undefined;

const DEFAULT_DASHBOARDS: DashboardDefinition[] = [
  {
    name: 'Targets Dashboard',
    moduleRoots: ['test'],
    excludedModules: ['unity', 'cmock', 'CMock', 'Cmock', 'Unity', 'template'],
    targets: DEFAULT_ALL_TEST_TARGETS,
  },
];

const normalizeDashboards = (dashboards: DashboardDefinition[]): DashboardDefinition[] =>
  dashboards
    .filter((dashboard) => typeof dashboard.name === 'string' && dashboard.name.trim().length > 0)
    .map((dashboard) => ({
      name: dashboard.name.trim(),
      moduleRoots: Array.isArray(dashboard.moduleRoots) ? dashboard.moduleRoots.filter(Boolean) : [],
      excludedModules: Array.isArray(dashboard.excludedModules)
        ? dashboard.excludedModules.filter(Boolean)
        : DEFAULT_DASHBOARDS[0].excludedModules,
      targets: Array.isArray(dashboard.targets) ? dashboard.targets.filter(Boolean) : [],
    }))
    .filter((dashboard) => dashboard.moduleRoots.length > 0);

const getDashboards = (): DashboardDefinition[] => {
  const config = vscode.workspace.getConfiguration('targetsRunner');
  const configured = config.get<DashboardDefinition[]>('dashboards', DEFAULT_DASHBOARDS);
  const normalized = normalizeDashboards(configured);
  return normalized.length > 0 ? normalized : DEFAULT_DASHBOARDS;
};

const getBuildSettings = (): Pick<SettingsState, 'buildSystem' | 'makeJobs' | 'maxParallel'> => {
  const config = vscode.workspace.getConfiguration('targetsRunner');
  return {
    buildSystem: config.get<string>('buildSystem', 'auto'),
    makeJobs: config.get<string | number>('makeJobs', 'auto'),
    maxParallel: config.get<number>('maxParallel', 4),
  };
};

export function activate(context: vscode.ExtensionContext): void {
  const menuViewProvider = new MenuViewProvider();
  const settingsViewProvider = new SettingsViewProvider(
    context.extensionUri,
    () => ({
      ...getBuildSettings(),
      dashboards: getDashboards(),
    }),
    async (message) => {
      const config = vscode.workspace.getConfiguration('targetsRunner');
      if (message.type === 'ready') {
        settingsViewProvider.refresh();
      }
      if (message.type === 'updateBuildSettings') {
        await config.update('buildSystem', message.payload.buildSystem, vscode.ConfigurationTarget.Workspace);
        await config.update('makeJobs', message.payload.makeJobs, vscode.ConfigurationTarget.Workspace);
        await config.update('maxParallel', message.payload.maxParallel, vscode.ConfigurationTarget.Workspace);
        settingsViewProvider.refresh();
      }
      if (message.type === 'updateDashboards') {
        await config.update('dashboards', message.payload, vscode.ConfigurationTarget.Workspace);
        settingsViewProvider.refresh();
      }
    },
  );

  const updateDashboardControllers = () => {
    for (const controller of dashboardControllers) {
      controller.dispose();
    }
    dashboardControllers = getDashboards().map(
      (dashboard) =>
        new DashboardController(context, {
          ...dashboard,
          moduleLabel: 'Module Name',
          actionsLabel: 'Module Actions',
          title: dashboard.name,
        }),
    );
    activeController = dashboardControllers[0];
    menuViewProvider.setDashboards(dashboardControllers.map((controller) => controller.name));
  };

  updateDashboardControllers();

  context.subscriptions.push(
    menuViewProvider,
    settingsViewProvider,
    vscode.window.registerTreeDataProvider('targetsRunner.menu', menuViewProvider),
    vscode.commands.registerCommand('targetsRunner.refresh', () => activeController?.refresh()),
    vscode.commands.registerCommand('targetsRunner.runAll', () => activeController?.runAll()),
    vscode.commands.registerCommand('targetsRunner.rerunFailed', () => activeController?.rerunFailed()),
    vscode.commands.registerCommand('targetsRunner.stopAll', () => activeController?.stopAll()),
    vscode.commands.registerCommand('targetsRunner.runTargetForModule', (moduleId: string) =>
      activeController?.runTargetForModule(moduleId),
    ),
    vscode.commands.registerCommand('targetsRunner.runTargetForAllModules', (target: string) =>
      activeController?.runTargetForAllModules(target),
    ),
    vscode.commands.registerCommand('targetsRunner.openDashboard', async (name?: string) => {
      if (dashboardControllers.length === 0) {
        await vscode.window.showWarningMessage('No dashboards are configured.');
        return;
      }
      if (!name) {
        const picked = await vscode.window.showQuickPick(dashboardControllers.map((controller) => controller.name), {
          placeHolder: 'Select a dashboard to open',
        });
        if (!picked) {
          return;
        }
        name = picked;
      }
      const controller = dashboardControllers.find((item) => item.name === name);
      if (!controller) {
        await vscode.window.showWarningMessage(`Dashboard "${name}" was not found.`);
        return;
      }
      activeController = controller;
      controller.showDashboard();
    }),
    vscode.commands.registerCommand('targetsRunner.openSettings', () => settingsViewProvider.show()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('targetsRunner.dashboards')) {
        updateDashboardControllers();
      }
      if (
        event.affectsConfiguration('targetsRunner.buildSystem') ||
        event.affectsConfiguration('targetsRunner.makeJobs') ||
        event.affectsConfiguration('targetsRunner.maxParallel')
      ) {
        settingsViewProvider.refresh();
      }
    }),
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
  for (const controller of dashboardControllers) {
    controller.dispose();
  }
}
