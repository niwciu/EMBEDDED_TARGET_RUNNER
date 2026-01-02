import * as vscode from 'vscode';

type MenuItemDefinition = {
  label: string;
  children?: MenuItemDefinition[];
  command?: vscode.Command;
};

const MENU_STRUCTURE: MenuItemDefinition[] = [
  {
    label: 'Project',
    children: [
      {
        label: 'Create project',
        command: {
          title: 'Create project',
          command: 'targetsRunner.menuAction',
          arguments: ['createProject'],
        },
      },
      {
        label: 'Format all source in project',
        command: {
          title: 'Format all source in project',
          command: 'targetsRunner.menuAction',
          arguments: ['formatAllSource'],
        },
      },
    ],
  },
  {
    label: 'Test',
    children: [
      {
        label: 'Add new test module',
        command: {
          title: 'Add new test module',
          command: 'targetsRunner.menuAction',
          arguments: ['addTestModule'],
        },
      },
      {
        label: 'Add new test group',
        command: {
          title: 'Add new test group',
          command: 'targetsRunner.menuAction',
          arguments: ['addTestGroup'],
        },
      },
      {
        label: 'Run all Tests',
        command: {
          title: 'Run all Tests',
          command: 'targetsRunner.menuAction',
          arguments: ['runAllTests'],
        },
      },
      {
        label: 'Targets Dashboard',
        command: {
          title: 'Targets Dashboard',
          command: 'targetsRunner.openDashboard',
        },
      },
    ],
  },
  {
    label: 'CI Checks',
    command: {
      title: 'CI Checks',
      command: 'targetsRunner.menuAction',
      arguments: ['ciChecks'],
    },
  },
  {
    label: 'Generate Reports',
    command: {
      title: 'Generate Reports',
      command: 'targetsRunner.menuAction',
      arguments: ['generateReports'],
    },
  },
  {
    label: 'HW Configurations',
    command: {
      title: 'HW Configurations',
      command: 'targetsRunner.menuAction',
      arguments: ['hwConfigurations'],
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
