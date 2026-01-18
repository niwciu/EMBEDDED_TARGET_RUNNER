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

const normalizeModuleRoots = (moduleRoots: DashboardDefinition['moduleRoots'] | string | undefined): string[] => {
  if (typeof moduleRoots === 'string') {
    return moduleRoots
      .split(',')
      .map((root) => root.trim())
      .filter(Boolean);
  }
  if (Array.isArray(moduleRoots)) {
    return moduleRoots
      .flatMap((root) =>
        typeof root === 'string'
          ? root
              .split(',')
              .map((entry) => entry.trim())
              .filter(Boolean)
          : [],
      )
      .filter(Boolean);
  }
  return [];
};

const normalizeDashboards = (dashboards: DashboardDefinition[]): DashboardDefinition[] =>
  dashboards
    .filter((dashboard) => typeof dashboard.name === 'string' && dashboard.name.trim().length > 0)
    .map((dashboard) => ({
      name: dashboard.name.trim(),
      moduleRoots: normalizeModuleRoots(dashboard.moduleRoots),
      excludedModules: Array.isArray(dashboard.excludedModules)
        ? dashboard.excludedModules.filter(Boolean)
        : DEFAULT_DASHBOARDS[0].excludedModules,
      targets: Array.isArray(dashboard.targets) ? dashboard.targets.filter(Boolean) : [],
    }))
    .filter((dashboard) => dashboard.moduleRoots.length > 0);

const getWorkspaceFolder = (): vscode.WorkspaceFolder | undefined => vscode.workspace.workspaceFolders?.[0];

const getSettingsTarget = (folder?: vscode.WorkspaceFolder): vscode.ConfigurationTarget => {
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1 && folder) {
    return vscode.ConfigurationTarget.WorkspaceFolder;
  }
  return vscode.ConfigurationTarget.Workspace;
};

const getDashboards = (): DashboardDefinition[] => {
  const folder = getWorkspaceFolder();
  const config = vscode.workspace.getConfiguration('targetsManager', folder?.uri);
  const configured = config.get<DashboardDefinition[]>('dashboards', DEFAULT_DASHBOARDS);
  const normalized = normalizeDashboards(configured);
  return normalized.length > 0 ? normalized : DEFAULT_DASHBOARDS;
};

const getBuildSettings = (): Pick<SettingsState, 'buildSystem' | 'makeJobs' | 'maxParallel'> => {
  const folder = getWorkspaceFolder();
  const config = vscode.workspace.getConfiguration('targetsManager', folder?.uri);
  const normalizeMakeJobs = (value: string | number): string | number => {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.toLowerCase() === 'auto') {
        return 'auto';
      }
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return 'auto';
  };
  return {
    buildSystem: config.get<string>('buildSystem', 'auto'),
    makeJobs: normalizeMakeJobs(config.get<string | number>('makeJobs', 'auto')),
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
      const folder = getWorkspaceFolder();
      const config = vscode.workspace.getConfiguration('targetsManager', folder?.uri);
      const target = getSettingsTarget(folder);
      if (message.type === 'ready') {
        settingsViewProvider.refresh();
      }
      if (message.type === 'updateBuildSettings') {
        await config.update('buildSystem', message.payload.buildSystem, target);
        await config.update('makeJobs', message.payload.makeJobs, target);
        await config.update('maxParallel', message.payload.maxParallel, target);
        settingsViewProvider.refresh();
      }
      if (message.type === 'updateDashboards') {
        await config.update('dashboards', message.payload, target);
        settingsViewProvider.refresh();
        updateDashboardControllers();
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
    vscode.window.registerTreeDataProvider('targetsManager.menu', menuViewProvider),
    vscode.commands.registerCommand('targetsManager.refresh', () => activeController?.refresh()),
    vscode.commands.registerCommand('targetsManager.runAll', () => activeController?.runAll()),
    vscode.commands.registerCommand('targetsManager.rerunFailed', () => activeController?.rerunFailed()),
    vscode.commands.registerCommand('targetsManager.stopAll', () => activeController?.stopAll()),
    vscode.commands.registerCommand('targetsManager.runTargetForModule', (moduleId: string) =>
      activeController?.runTargetForModule(moduleId),
    ),
    vscode.commands.registerCommand('targetsManager.runTargetForAllModules', (target: string) =>
      activeController?.runTargetForAllModules(target),
    ),
    vscode.commands.registerCommand('targetsManager.openDashboard', async (name?: string) => {
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
    vscode.commands.registerCommand('targetsManager.openSettings', () => settingsViewProvider.show()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('targetsManager.dashboards')) {
        updateDashboardControllers();
      }
      if (
        event.affectsConfiguration('targetsManager.buildSystem') ||
        event.affectsConfiguration('targetsManager.makeJobs') ||
        event.affectsConfiguration('targetsManager.maxParallel')
      ) {
        settingsViewProvider.refresh();
      }
    }),
    vscode.commands.registerCommand('targetsManager.menuAction', async (action: string) => {
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
