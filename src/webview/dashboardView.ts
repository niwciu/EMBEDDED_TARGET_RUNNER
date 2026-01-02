import * as vscode from 'vscode';
import { DashboardState } from '../state/types';

export type WebviewMessage =
  | { type: 'runTarget'; moduleId: string; target: string }
  | { type: 'runTargetForModule'; moduleId: string }
  | { type: 'runTargetForAllModules'; target: string }
  | { type: 'reveal'; moduleId: string; target: string }
  | { type: 'configureModule'; moduleId: string }
  | { type: 'reconfigureModule'; moduleId: string }
  | { type: 'configureAllModules' }
  | { type: 'refresh' }
  | { type: 'runAll' }
  | { type: 'rerunFailed' }
  | { type: 'stopAll' };

export class DashboardViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private lastState?: DashboardState;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onMessage: (message: WebviewMessage) => void,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
    };
    view.webview.html = this.getHtml(view.webview);
    view.webview.onDidReceiveMessage((message) => this.onMessage(message));
    if (this.lastState) {
      void view.webview.postMessage({ type: 'state', payload: this.lastState });
    }
  }

  setState(state: DashboardState): void {
    this.lastState = state;
    if (!this.view) {
      return;
    }
    this.view.webview.postMessage({ type: 'state', payload: state });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = String(Date.now());
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Targets Dashboard</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 8px; }
    .toolbar { display: flex; gap: 8px; margin-bottom: 8px; }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 4px; text-align: center; border-bottom: 1px solid var(--vscode-editorGroup-border); }
    th { position: sticky; top: 0; background: var(--vscode-editor-background); }
    td.module { text-align: left; cursor: pointer; }
    td.actions { text-align: left; }
    .cell { display: flex; align-items: center; justify-content: center; gap: 6px; }
    .run { opacity: 1; font-size: 12px; cursor: pointer; }
    .status { font-weight: 600; cursor: pointer; }
    .status.idle { color: var(--vscode-descriptionForeground); }
    .status.running { color: var(--vscode-terminal-ansiYellow); }
    .status.success { color: var(--vscode-terminal-ansiGreen); }
    .status.failed { color: var(--vscode-terminal-ansiRed); }
    .status.missing { color: var(--vscode-disabledForeground); }
    .module-actions { display: inline-flex; gap: 6px; }
    .module-actions button { font-size: 12px; padding: 2px 6px; min-width: 24px; background: transparent; color: var(--vscode-foreground); border: 1px solid var(--vscode-editorGroup-border); }
    .module-actions button:hover { background: var(--vscode-list-hoverBackground); }
    .module-actions button:disabled { opacity: 0.5; cursor: not-allowed; }
    .target-header-content { display: inline-flex; align-items: center; gap: 6px; }
    .target-header button { background: transparent; color: var(--vscode-foreground); border: 1px solid var(--vscode-editorGroup-border); padding: 2px 6px; border-radius: 4px; cursor: pointer; font-size: 12px; }
    .target-header button:hover { background: var(--vscode-list-hoverBackground); }
  </style>
</head>
<body>
  <div class="toolbar">
    <button data-action="refresh">Refresh</button>
    <button data-action="configureAllModules">Configure All</button>
    <button data-action="runAll">Run All</button>
    <button data-action="rerunFailed">Rerun Failed</button>
    <button data-action="stopAll">Stop All</button>
  </div>
  <div id="table"></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const table = document.getElementById('table');

    document.querySelectorAll('button[data-action]').forEach((button) => {
      button.addEventListener('click', () => {
        vscode.postMessage({ type: button.dataset.action });
      });
    });

    function render(state) {
      if (!state || !state.modules) {
        table.innerHTML = '<p>No modules found.</p>';
        return;
      }

      const headerTargets = state.targets.map((target) =>
        [
          '<th data-target=\"' + target.name + '\" class=\"target-header\">',
          '<span class=\"target-header-content\">',
          '<span>' + target.name + '</span>',
          '<button title=\"Run target for all modules\" data-run-all-target=\"true\" data-target=\"' + target.name + '\">▶</button>',
          '</span>',
          '</th>',
        ].join(''),
      ).join('');
      const rows = state.modules.map((moduleState) => {
        const configureLabel = moduleState.needsConfigure ? 'Configure module (create out/)' : 'Reconfigure module (delete out/ then configure)';
        const configureAction = moduleState.needsConfigure ? 'configure' : 'reconfigure';
        const configureIcon = moduleState.needsConfigure ? '🛠️' : '♻️';
        const runDisabled = moduleState.needsConfigure ? 'disabled' : '';
        const moduleActions = [
          '<span class=\"module-actions\">',
          '<button title=\"' + configureLabel + '\" data-configure=\"true\" data-action=\"' + configureAction + '\" data-module=\"' + moduleState.module.id + '\">' + configureIcon + '</button>',
          '<button title=\"Run all targets\" data-run-module=\"true\" data-module=\"' + moduleState.module.id + '\" ' + runDisabled + '>▶</button>',
          '</span>',
        ].join('');
        const cells = state.targets.map((target) => {
          const available = moduleState.availability[target.name];
          const run = moduleState.runs[target.name] || { status: 'idle' };
          if (!available) {
            return '<td><div class=\"cell\"><span class=\"status missing\">-</span></div></td>';
          }
          const statusClass = run.status;
          const icon = run.status === 'running' ? '⏳' : run.status === 'success' ? '✓' : run.status === 'failed' ? '✗' : '•';
          return [
            '<td data-module=\"' + moduleState.module.id + '\" data-target=\"' + target.name + '\">',
            '<div class=\"cell\">',
            '<span class=\"status ' + statusClass + '\" data-reveal=\"true\">' + icon + '</span>',
            '<span class=\"run\" data-run=\"true\">▶</span>',
            '</div>',
            '</td>',
          ].join('');
        }).join('');
        return [
          '<tr>',
          '<td class=\"module\" data-module=\"' + moduleState.module.id + '\">' + moduleState.module.name + '</td>',
          '<td class=\"actions\">' + moduleActions + '</td>',
          cells,
          '</tr>',
        ].join('');
      }).join('');

      table.innerHTML = [
        '<table>',
        '<thead>',
        '<tr>',
        '<th colspan=\"2\">Module</th>',
        '<th colspan=\"' + state.targets.length + '\">CI targets</th>',
        '</tr>',
        '<tr>',
        '<th>Name</th>',
        '<th>Actions</th>',
        headerTargets,
        '</tr>',
        '</thead>',
        '<tbody>',
        rows,
        '</tbody>',
        '</table>',
      ].join('');

      table.querySelectorAll('td.module').forEach((cell) => {
        cell.addEventListener('click', () => {
          vscode.postMessage({ type: 'runTargetForModule', moduleId: cell.dataset.module });
        });
      });

      table.querySelectorAll('button[data-configure=\"true\"]').forEach((button) => {
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          const action = button.dataset.action;
          if (action === 'reconfigure') {
            vscode.postMessage({ type: 'reconfigureModule', moduleId: button.dataset.module });
          } else {
            vscode.postMessage({ type: 'configureModule', moduleId: button.dataset.module });
          }
        });
      });

      table.querySelectorAll('button[data-run-module=\"true\"]').forEach((button) => {
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          vscode.postMessage({ type: 'runTargetForModule', moduleId: button.dataset.module });
        });
      });

      table.querySelectorAll('button[data-run-all-target=\"true\"]').forEach((button) => {
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          vscode.postMessage({ type: 'runTargetForAllModules', target: button.dataset.target });
        });
      });

      table.querySelectorAll('[data-run="true"]').forEach((runButton) => {
        runButton.addEventListener('click', (event) => {
          const cell = event.target.closest('td');
          vscode.postMessage({ type: 'runTarget', moduleId: cell.dataset.module, target: cell.dataset.target });
        });
      });

      table.querySelectorAll('[data-reveal="true"]').forEach((status) => {
        status.addEventListener('click', (event) => {
          const cell = event.target.closest('td');
          vscode.postMessage({ type: 'reveal', moduleId: cell.dataset.module, target: cell.dataset.target });
        });
      });
    }

    window.addEventListener('message', (event) => {
      if (event.data?.type === 'state') {
        render(event.data.payload);
      }
    });
  </script>
</body>
</html>`;
  }
}
