import * as fs from 'fs/promises';
import * as path from 'path';
import { runCommand } from '../utils/exec';
import { BuildSystem, CMakeGenerator, selectGenerator } from './generator';

export interface ConfigureResult {
  configured: boolean;
  generator: CMakeGenerator;
}

export async function hasCMakeCache(modulePath: string): Promise<boolean> {
  const cachePath = path.join(modulePath, 'out', 'CMakeCache.txt');
  try {
    const stat = await fs.stat(cachePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function ensureConfigured(modulePath: string, buildSystem: BuildSystem): Promise<ConfigureResult> {
  const outDir = path.join(modulePath, 'out');
  let exists = false;
  try {
    const stat = await fs.stat(outDir);
    exists = stat.isDirectory();
  } catch {
    exists = false;
  }

  const generator = await selectGenerator(buildSystem, outDir);
  if (exists && (await hasCMakeCache(modulePath))) {
    return { configured: false, generator };
  }

  await fs.mkdir(outDir, { recursive: true });
  await runCommand('cmake', ['-S', './', '-B', 'out', '-G', generator], modulePath);
  return { configured: true, generator };
}
