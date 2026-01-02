import * as vscode from 'vscode';
import { CMakeGenerator } from '../cmake/generator';

export type TargetRunStatus = 'idle' | 'running' | 'success' | 'failed';

export interface ModuleInfo {
  id: string;
  name: string;
  path: string;
  workspaceFolder: vscode.WorkspaceFolder;
}

export interface TargetDefinition {
  name: string;
}

export interface TargetAvailability {
  [targetName: string]: boolean;
}

export interface RunResult {
  status: TargetRunStatus;
  exitCode?: number;
  startedAt?: number;
  finishedAt?: number;
}

export interface ModuleState {
  module: ModuleInfo;
  availability: TargetAvailability;
  runs: Record<string, RunResult>;
  generator?: CMakeGenerator;
}

export interface DashboardState {
  modules: ModuleState[];
  targets: TargetDefinition[];
}
