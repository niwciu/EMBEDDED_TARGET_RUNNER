import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import * as vscode from 'vscode';
import { setTaskWarnings } from './taskRegistry';

export class SpawnTaskTerminal implements vscode.Pseudoterminal {
  private readonly writeEmitter = new vscode.EventEmitter<string>();
  private readonly closeEmitter = new vscode.EventEmitter<number | undefined>();
  private readonly warningRegex = /warning:/i;
  private readonly shell = process.platform === 'win32';
  private buffer = '';
  private childProcess?: ChildProcessWithoutNullStreams;
  private sawWarning = false;
  private finished = false;

  constructor(
    private readonly command: string,
    private readonly args: string[],
    private readonly cwd: string,
    private readonly taskKey: string,
  ) {}

  onDidWrite: vscode.Event<string> = this.writeEmitter.event;
  onDidClose: vscode.Event<number | undefined> = this.closeEmitter.event;

  open(): void {
    this.childProcess = spawn(this.command, this.args, { cwd: this.cwd, shell: this.shell });
    this.childProcess.stdout.on('data', (data) => {
      this.handleData(data.toString());
    });
    this.childProcess.stderr.on('data', (data) => {
      this.handleData(data.toString());
    });
    this.childProcess.on('error', (error) => {
      this.handleData(`Failed to start task: ${error.message}\r\n`);
      this.finish(1);
    });
    this.childProcess.on('close', (code) => {
      this.finish(code ?? 0);
    });
  }

  close(): void {
    if (this.childProcess && !this.childProcess.killed) {
      this.childProcess.kill();
    }
  }

  private finish(exitCode: number): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    setTaskWarnings(this.taskKey, this.sawWarning);
    this.closeEmitter.fire(exitCode);
  }

  private handleData(text: string): void {
    this.writeEmitter.fire(text);
    this.scanForWarnings(text);
  }

  private scanForWarnings(text: string): void {
    this.buffer += text;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (this.warningRegex.test(line)) {
        this.sawWarning = true;
        break;
      }
    }
  }
}
