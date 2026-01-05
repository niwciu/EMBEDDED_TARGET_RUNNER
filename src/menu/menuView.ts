import * as vscode from 'vscode';

type MenuItemDefinition = {
  label: string;
  children?: MenuItemDefinition[];
  command?: vscode.Command;
};

const MENU_STRUCTURE: MenuItemDefinition[] = [
  {
    label: 'Targets Dashboard Manager',
    command: {
      title: 'Targets Dashboard Manager',
      command: 'targetsRunner.openDashboard',
    },
  },
  {
    label: 'Targets Manager Options',
    command: {
      title: 'Targets Manager Options',
      command: 'workbench.action.openSettings',
      arguments: ['@ext:embedded.embedded-target-runner'],
    },
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

  dispose(): void {
    this.onDidChangeTreeDataEmitter.dispose();
  }

  getTreeItem(element: MenuItemDefinition): vscode.TreeItem {
    return new MenuTreeItem(element);
  }

  getChildren(element?: MenuItemDefinition): MenuItemDefinition[] {
    if (!element) {
      return MENU_STRUCTURE;
    }
    return element.children ?? [];
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }
}
