import * as path from 'path';
import { runCommand } from '../utils/exec';
import { CMakeGenerator } from './generator';

export async function detectTargets(modulePath: string, generator: CMakeGenerator): Promise<Set<string>> {
  const outDir = path.join(modulePath, 'out');
  const targets = new Set<string>();
  if (generator === 'Ninja') {
    const result = await runCommand('ninja', ['-C', 'out', '-t', 'targets'], modulePath);
    const output = `${result.stdout}\n${result.stderr}`;
    collectTargetsFromLines(output, targets);
    return targets;
  }

  const result = await runCommand('cmake', ['--build', 'out', '--target', 'help'], modulePath);
  const output = `${result.stdout}\n${result.stderr}`;
  collectTargetsFromLines(output, targets);

  if (targets.size === 0) {
    const fallback = await runCommand('make', ['-C', outDir, 'help'], modulePath);
    const fallbackOutput = `${fallback.stdout}\n${fallback.stderr}`;
    collectTargetsFromLines(fallbackOutput, targets);
  }

  return targets;
}

function collectTargetsFromLines(output: string, targets: Set<string>): void {
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*\.\.\.\s+([A-Za-z0-9_.:+-]+)\b/);
    if (match) {
      targets.add(match[1]);
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed || trimmed.toLowerCase().startsWith('the following')) {
      continue;
    }
    const token = trimmed.split(/\s+/)[0];
    if (token && !token.includes(':')) {
      targets.add(token);
    }
  }
}
