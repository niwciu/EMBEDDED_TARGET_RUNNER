import * as path from 'path';
import { runCommand } from '../utils/exec';
import { CMakeGenerator } from './generator';

export async function detectTargets(modulePath: string, generator: CMakeGenerator): Promise<Set<string>> {
  const outDir = path.join(modulePath, 'out');
  const targets = new Set<string>();
  if (generator === 'Ninja') {
    const result = await runCommand('ninja', ['-C', 'out', '-t', 'targets'], modulePath);
    for (const line of result.stdout.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const targetName = trimmed.split(/[:\s]/)[0];
      if (targetName) {
        targets.add(targetName);
      }
    }
    return targets;
  }

  const result = await runCommand('cmake', ['--build', 'out', '--target', 'help'], modulePath);
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/^\.\.\.\s+([A-Za-z0-9_.:+-]+)\s/);
    if (match) {
      targets.add(match[1]);
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('The following')) {
      continue;
    }
    const token = trimmed.split(/\s+/)[0];
    if (token) {
      targets.add(token);
    }
  }
  return targets;
}
