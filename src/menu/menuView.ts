import * as vscode from 'vscode';

type MenuItemDefinition = {
  label: string;
  children?: MenuItemDefinition[];
  command?: vscode.Command;
};

const MENU_TITLE = 'Embedded Targets Manager';

const createMenuStructure = (dashboards: string[]): MenuItemDefinition[] => [
  {
    label: MENU_TITLE,
    children: [
      {
        label: 'Options',
        command: {
          title: 'Options',
          command: 'workbench.action.openSettings',
          arguments: ['@ext:embedded.embedded-target-runner'],
        },
      },
      {
        label: 'Targets Dashboard Manager',
        command: {
          title: 'Targets Dashboard Manager',
          command: 'targetsRunner.openDashboard',
        },
      },
      ...dashboards.map((name) => ({
        label: name,
        command: {
          title: name,
          command: 'targetsRunner.openDashboard',
          arguments: [name],
        },
      })),
    ],
  },
];

class MenuTreeItem extends vscode.TreeItem {
  constructor(definition: MenuItemDefinition) {
    super(
      definition.label,
      definition.children?.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    );
    this.command = definition.command;
  }
}

export class MenuViewProvider implements vscode.TreeDataProvider<MenuItemDefinition>, vscode.Disposable {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<MenuItemDefinition | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private dashboards: string[] = [];

  dispose(): void {
    this.onDidChangeTreeDataEmitter.dispose();
  }

  setDashboards(dashboards: string[]): void {
    this.dashboards = dashboards;
    this.refresh();
  }

  getTreeItem(element: MenuItemDefinition): vscode.TreeItem {
    return new MenuTreeItem(element);
  }

  getChildren(element?: MenuItemDefinition): MenuItemDefinition[] {
    if (!element) {
      return createMenuStructure(this.dashboards);
    }
    return element.children ?? [];
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }
}
