import * as vscode from 'vscode';

export type DashboardSettings = {
  name: string;
  moduleRoots: string[];
  excludedModules: string[];
  targets: string[];
};

export type SettingsState = {
  buildSystem: string;
  makeJobs: string | number;
  maxParallel: number;
  dashboards: DashboardSettings[];
};

type SettingsMessage =
  | { type: 'ready' }
  | { type: 'updateBuildSettings'; payload: Pick<SettingsState, 'buildSystem' | 'makeJobs' | 'maxParallel'> }
  | { type: 'updateDashboards'; payload: DashboardSettings[] };

export class SettingsViewProvider implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly getState: () => SettingsState,
    private readonly onMessage: (message: SettingsMessage) => void,
  ) {}

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }

  show(): void {
    if (this.panel) {
      this.panel.reveal();
      this.refresh();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'targetsManager.settings',
      'Embedded Targets Manager Settings',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );
    this.panel.webview.html = this.getHtml(this.panel.webview);
    this.panel.webview.onDidReceiveMessage((message) => this.onMessage(message as SettingsMessage));
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
    this.refresh();
  }

  refresh(): void {
    if (!this.panel) {
      return;
    }
    void this.panel.webview.postMessage({ type: 'state', payload: this.getState() });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = String(Date.now());
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Embedded Targets Manager Settings</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px; font-size: 14px; }
    h2 { font-size: 16px; margin: 16px 0 8px; }
    label { display: block; font-weight: 600; margin-bottom: 4px; }
    input, select, textarea { width: 100%; padding: 6px; margin-bottom: 10px; box-sizing: border-box; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); }
    textarea { min-height: 70px; resize: vertical; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    .panel { border: 1px solid var(--vscode-editorGroup-border); border-radius: 6px; padding: 10px; }
    .buttons { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 10px; border-radius: 4px; cursor: pointer; }
    button.secondary { background: transparent; color: var(--vscode-foreground); border: 1px solid var(--vscode-editorGroup-border); }
    button.danger { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-inputValidation-errorBorder); }
    .list { display: flex; flex-direction: column; gap: 4px; }
    .list button { text-align: left; justify-content: flex-start; }
    .selected { border-color: var(--vscode-focusBorder); }
    .hint { color: var(--vscode-descriptionForeground); font-size: 12px; }
  </style>
</head>
<body>
  <h2>Build System</h2>
  <div class="panel">
    <div class="grid">
      <div>
        <label for="buildSystem">Build system</label>
        <select id="buildSystem">
          <option value="auto">Auto</option>
          <option value="ninja">Ninja</option>
          <option value="make">Make</option>
        </select>
      </div>
      <div>
        <label for="makeJobs">Make jobs</label>
        <input id="makeJobs" placeholder="auto or number" />
      </div>
      <div>
        <label for="maxParallel">Max parallel</label>
        <input id="maxParallel" type="number" min="1" />
      </div>
    </div>
    <div class="buttons">
      <button id="saveBuild">Save build settings</button>
    </div>
  </div>

  <h2>Dashboards</h2>
  <div class="grid">
    <div class="panel">
      <label>Dashboards</label>
      <div id="dashboardList" class="list"></div>
      <div class="buttons">
        <button id="addDashboard">Add dashboard</button>
        <button id="removeDashboard" class="danger">Remove</button>
      </div>
    </div>
    <div class="panel">
      <label for="dashboardName">Name</label>
      <input id="dashboardName" />
      <label for="moduleRoots">Module roots (comma or newline separated)</label>
      <textarea id="moduleRoots" placeholder="e.g. test&#10;or: test, integration"></textarea>
      <label for="excludedModules">Excluded modules (comma-separated)</label>
      <textarea id="excludedModules"></textarea>
      <label for="targets">Targets (comma-separated)</label>
      <textarea id="targets"></textarea>
      <div class="buttons">
        <button id="saveDashboard">Save dashboard</button>
      </div>
      <div class="hint">Dashboards must have a name and at least one module root.</div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const state = { dashboards: [], buildSystem: 'auto', makeJobs: 'auto', maxParallel: 4, selectedIndex: 0 };

    const buildSystem = document.getElementById('buildSystem');
    const makeJobs = document.getElementById('makeJobs');
    const maxParallel = document.getElementById('maxParallel');
    const saveBuild = document.getElementById('saveBuild');

    const dashboardList = document.getElementById('dashboardList');
    const addDashboard = document.getElementById('addDashboard');
    const removeDashboard = document.getElementById('removeDashboard');
    const saveDashboard = document.getElementById('saveDashboard');

    const dashboardName = document.getElementById('dashboardName');
    const moduleRootsInput = document.getElementById('moduleRoots');
    const excludedModules = document.getElementById('excludedModules');
    const targets = document.getElementById('targets');

    const toList = (value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

    const toMultilineList = (value) =>
      value
        .split('\\n')
        .flatMap((line) => line.split(','))
        .map((item) => item.trim())
        .filter(Boolean);

    const renderDashboards = () => {
      dashboardList.innerHTML = '';
      state.dashboards.forEach((dashboard, index) => {
        const button = document.createElement('button');
        button.textContent = dashboard.name || 'Dashboard ' + (index + 1);
        if (index === state.selectedIndex) {
          button.classList.add('selected');
        }
        button.addEventListener('click', () => {
          state.selectedIndex = index;
          renderDashboards();
          fillDashboardForm();
        });
        dashboardList.appendChild(button);
      });
      removeDashboard.disabled = state.dashboards.length === 0;
    };

    const fillDashboardForm = () => {
      const dashboard = state.dashboards[state.selectedIndex];
      if (!dashboard) {
        dashboardName.value = '';
        moduleRootsInput.value = '';
        excludedModules.value = '';
        targets.value = '';
        return;
      }
      dashboardName.value = dashboard.name ?? '';
      moduleRootsInput.value = (dashboard.moduleRoots || []).join('\\n');
      excludedModules.value = (dashboard.excludedModules || []).join(', ');
      targets.value = (dashboard.targets || []).join(', ');
    };

    const applyState = (payload) => {
      state.buildSystem = payload.buildSystem;
      state.makeJobs = payload.makeJobs;
      state.maxParallel = payload.maxParallel;
      state.dashboards = payload.dashboards || [];
      state.selectedIndex = Math.min(state.selectedIndex, Math.max(state.dashboards.length - 1, 0));
      buildSystem.value = state.buildSystem;
      makeJobs.value = state.makeJobs;
      maxParallel.value = state.maxParallel;
      renderDashboards();
      fillDashboardForm();
    };

    saveBuild.addEventListener('click', () => {
      const parsedJobs = Number(makeJobs.value);
      const makeJobsValue = Number.isFinite(parsedJobs) && parsedJobs > 0 ? parsedJobs : makeJobs.value || 'auto';
      vscode.postMessage({
        type: 'updateBuildSettings',
        payload: {
          buildSystem: buildSystem.value,
          makeJobs: makeJobsValue,
          maxParallel: Number(maxParallel.value) || 1,
        },
      });
    });

    addDashboard.addEventListener('click', () => {
      state.dashboards.push({ name: 'New Dashboard', moduleRoots: ['test'], excludedModules: [], targets: [] });
      state.selectedIndex = state.dashboards.length - 1;
      renderDashboards();
      fillDashboardForm();
      vscode.postMessage({ type: 'updateDashboards', payload: state.dashboards });
    });

    removeDashboard.addEventListener('click', () => {
      if (state.dashboards.length === 0) {
        return;
      }
      state.dashboards.splice(state.selectedIndex, 1);
      state.selectedIndex = Math.max(state.selectedIndex - 1, 0);
      renderDashboards();
      fillDashboardForm();
      vscode.postMessage({ type: 'updateDashboards', payload: state.dashboards });
    });

    saveDashboard.addEventListener('click', () => {
      const moduleRoots = toMultilineList(moduleRootsInput.value);
      if (!dashboardName.value.trim()) {
        alert('Dashboard name is required.');
        return;
      }
      if (moduleRoots.length === 0) {
        alert('At least one module root is required.');
        return;
      }
      const dashboard = {
        name: dashboardName.value.trim(),
        moduleRoots,
        excludedModules: toList(excludedModules.value),
        targets: toList(targets.value),
      };
      state.dashboards[state.selectedIndex] = dashboard;
      renderDashboards();
      fillDashboardForm();
      vscode.postMessage({ type: 'updateDashboards', payload: state.dashboards });
    });

    window.addEventListener('message', (event) => {
      if (event.data?.type === 'state') {
        applyState(event.data.payload);
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}
