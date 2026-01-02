import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { TargetDefinition } from '../state/types';

export const DEFAULT_ALL_TEST_TARGETS = [
  'format',
  'format_test',
  'all',
  'run',
  'cppcheck',
  'ccm',
  'ccc',
  'ccmr',
  'ccr',
  'ccca',
  'ccra',
];

export const DEFAULT_HW_TARGETS = ['all', 'flash', 'reset', 'erase'];

export const DEFAULT_HW_TEST_TARGETS = [...DEFAULT_HW_TARGETS];

export const DEFAULT_CI_TARGETS = ['run', 'cppcheck', 'ccm', 'ccc', 'format_check'];

export const DEFAULT_REPORT_TARGETS = ['ccr', 'ccmr'];

export const DEFAULT_FORMAT_TARGETS = ['format', 'format_test'];

interface TargetsFile {
  targets?: string[];
  all_test_targets?: string[];
  test?: string[];
  hw?: string[];
  hw_test?: string[];
  ci?: string[];
  reports?: string[];
  format?: string[];
}

export async function loadTargets(
  workspaceFolder: vscode.WorkspaceFolder,
  targetsFile: string,
  listKey: keyof TargetsFile,
  defaultTargets: string[],
): Promise<TargetDefinition[]> {
  const filePath = path.join(workspaceFolder.uri.fsPath, targetsFile);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as TargetsFile;
    if (Array.isArray(parsed.targets) && parsed.targets.length > 0) {
      return parsed.targets.map((name) => ({ name }));
    }
    const list = parsed[listKey];
    if (Array.isArray(list) && list.length > 0) {
      return list.map((name) => ({ name }));
    }
  } catch {
    // fall back to defaults
  }

  return defaultTargets.map((name) => ({ name }));
}
