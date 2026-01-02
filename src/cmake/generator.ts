import * as fs from 'fs/promises';
import * as path from 'path';
import { commandExists } from '../utils/exec';

export type BuildSystem = 'auto' | 'ninja' | 'make';
export type CMakeGenerator = 'Ninja' | 'Unix Makefiles';

const CACHE_FILE = 'CMakeCache.txt';

export async function detectExistingGenerator(outDir: string): Promise<CMakeGenerator | null> {
  try {
    const cachePath = path.join(outDir, CACHE_FILE);
    const contents = await fs.readFile(cachePath, 'utf8');
    const match = contents.match(/^CMAKE_GENERATOR:INTERNAL=(.+)$/m);
    if (match) {
      const value = match[1].trim();
      if (value === 'Ninja') {
        return 'Ninja';
      }
      if (value === 'Unix Makefiles') {
        return 'Unix Makefiles';
      }
    }
  } catch {
    return null;
  }
  return null;
}

export async function selectGenerator(buildSystem: BuildSystem, outDir: string): Promise<CMakeGenerator> {
  if (buildSystem === 'ninja') {
    return 'Ninja';
  }
  if (buildSystem === 'make') {
    return 'Unix Makefiles';
  }

  const existing = await detectExistingGenerator(outDir);
  if (existing) {
    return existing;
  }

  if (await commandExists('ninja')) {
    return 'Ninja';
  }

  return 'Unix Makefiles';
}
