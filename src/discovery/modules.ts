import * as fs from 'fs/promises';
import { Dirent } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ModuleInfo } from '../state/types';

const CMAKE_LISTS = 'CMakeLists.txt';
const CUSTOM_TARGETS = 'custom_targets.cmake';

async function isModuleDirectory(dirPath: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.some((entry) => entry.isFile() && (entry.name === CMAKE_LISTS || entry.name === CUSTOM_TARGETS));
  } catch {
    return false;
  }
}

export async function discoverModules(workspaceFolder: vscode.WorkspaceFolder, modulesRoot: string): Promise<ModuleInfo[]> {
  const rootPath = path.join(workspaceFolder.uri.fsPath, modulesRoot);
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(rootPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const modules: ModuleInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const modulePath = path.join(rootPath, entry.name);
    if (await isModuleDirectory(modulePath)) {
      modules.push({
        id: `${workspaceFolder.uri.fsPath}:${entry.name}`,
        name: entry.name,
        path: modulePath,
        workspaceFolder,
      });
    }
  }

  return modules.sort((a, b) => a.name.localeCompare(b.name));
}
