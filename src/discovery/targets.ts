import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { TargetDefinition } from '../state/types';

const DEFAULT_TARGETS = [
  'format',
  'format_test',
  'run',
  'run_ctest',
  'cppcheck',
  'ccm',
  'ccc',
  'ccmr',
  'ccr',
  'ccca',
  'ccra',
];

interface TargetsFile {
  targets?: string[];
}

export async function loadTargets(workspaceFolder: vscode.WorkspaceFolder, targetsFile: string): Promise<TargetDefinition[]> {
  const filePath = path.join(workspaceFolder.uri.fsPath, targetsFile);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as TargetsFile;
    if (Array.isArray(parsed.targets) && parsed.targets.length > 0) {
      return parsed.targets.map((name) => ({ name }));
    }
  } catch {
    // fall back to defaults
  }

  return DEFAULT_TARGETS.map((name) => ({ name }));
}

export function getDefaultTargets(): TargetDefinition[] {
  return DEFAULT_TARGETS.map((name) => ({ name }));
}
