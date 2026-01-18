import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 10 * 1024 * 1024;

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export interface ExecResultWithExitCode extends ExecResult {
  exitCode?: number;
}

export async function runCommand(command: string, args: string[], cwd: string): Promise<ExecResult> {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd,
    maxBuffer: MAX_BUFFER,
    env: process.env,
  });
  return { stdout: stdout ?? '', stderr: stderr ?? '' };
}

export async function runCommandWithExitCode(
  command: string,
  args: string[],
  cwd: string,
): Promise<ExecResultWithExitCode> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      maxBuffer: MAX_BUFFER,
      env: process.env,
    });
    return { stdout: stdout ?? '', stderr: stderr ?? '', exitCode: 0 };
  } catch (error) {
    if (error && typeof error === 'object' && 'stdout' in error && 'stderr' in error) {
      const stdout =
        typeof error.stdout === 'string'
          ? error.stdout
          : Buffer.isBuffer(error.stdout)
            ? error.stdout.toString()
            : '';
      const stderr =
        typeof error.stderr === 'string'
          ? error.stderr
          : Buffer.isBuffer(error.stderr)
            ? error.stderr.toString()
            : '';
      const exitCode =
        'code' in error && typeof error.code === 'number'
          ? error.code
          : 'code' in error && error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
            ? 0
            : undefined;
      return { stdout, stderr, exitCode };
    }
    return { stdout: '', stderr: '', exitCode: undefined };
  }
}

export async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync(command, ['--version']);
    return true;
  } catch {
    return false;
  }
}
