import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export async function runCommand(command: string, args: string[], cwd: string): Promise<ExecResult> {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd,
    maxBuffer: 1024 * 1024,
    env: process.env,
  });
  return { stdout: stdout ?? '', stderr: stderr ?? '' };
}

export async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync(command, ['--version']);
    return true;
  } catch {
    return false;
  }
}
