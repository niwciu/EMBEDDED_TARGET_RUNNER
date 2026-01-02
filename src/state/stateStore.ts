import { CMakeGenerator } from '../cmake/generator';
import { DashboardState, ModuleInfo, ModuleState, RunResult, TargetDefinition } from './types';

export class StateStore {
  private modules: ModuleState[] = [];
  private targets: TargetDefinition[] = [];

  setTargets(targets: TargetDefinition[]): void {
    this.targets = targets;
    for (const moduleState of this.modules) {
      for (const target of targets) {
        moduleState.runs[target.name] = moduleState.runs[target.name] ?? { status: 'idle' };
      }
    }
  }

  setModules(modules: ModuleInfo[]): void {
    this.modules = modules.map((module) => ({
      module,
      availability: {},
      runs: {},
      needsConfigure: false,
    }));
    for (const moduleState of this.modules) {
      for (const target of this.targets) {
        moduleState.runs[target.name] = { status: 'idle' };
      }
    }
  }

  setModuleGenerator(moduleId: string, generator: CMakeGenerator): void {
    const moduleState = this.modules.find((state) => state.module.id === moduleId);
    if (moduleState) {
      moduleState.generator = generator;
    }
  }

  setNeedsConfigure(moduleId: string, needsConfigure: boolean): void {
    const moduleState = this.modules.find((state) => state.module.id === moduleId);
    if (moduleState) {
      moduleState.needsConfigure = needsConfigure;
    }
  }

  setAvailability(moduleId: string, targetName: string, available: boolean): void {
    const moduleState = this.modules.find((state) => state.module.id === moduleId);
    if (moduleState) {
      moduleState.availability[targetName] = available;
    }
  }

  updateRun(moduleId: string, targetName: string, update: RunResult): void {
    const moduleState = this.modules.find((state) => state.module.id === moduleId);
    if (!moduleState) {
      return;
    }
    moduleState.runs[targetName] = {
      ...moduleState.runs[targetName],
      ...update,
    };
  }

  getModuleState(moduleId: string): ModuleState | undefined {
    return this.modules.find((state) => state.module.id === moduleId);
  }

  getState(): DashboardState {
    return {
      modules: this.modules,
      targets: this.targets,
    };
  }

  getFailedTargets(): Array<{ module: ModuleInfo; target: string }> {
    const failed: Array<{ module: ModuleInfo; target: string }> = [];
    for (const moduleState of this.modules) {
      for (const [target, result] of Object.entries(moduleState.runs)) {
        if (result.status === 'failed') {
          failed.push({ module: moduleState.module, target });
        }
      }
    }
    return failed;
  }

  getAllTargets(): Array<{ module: ModuleInfo; target: string }> {
    const all: Array<{ module: ModuleInfo; target: string }> = [];
    for (const moduleState of this.modules) {
      for (const target of this.targets) {
        if (moduleState.availability[target.name]) {
          all.push({ module: moduleState.module, target: target.name });
        }
      }
    }
    return all;
  }
}
