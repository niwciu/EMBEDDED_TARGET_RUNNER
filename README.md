# Embedded Targets Manager

A VS Code extension that discovers CMake modules from configured roots, shows dashboards of custom targets, and runs them through native VS Code tasks/terminals.

## Features

- Configurable dashboards with per-dashboard module roots, exclusions, and target lists
- Module discovery under one or two root paths per dashboard
- Parallel execution with controlled concurrency
- Native terminal output with clickable file:line:column links
- Status dashboard (⏳ ✓ ✗ -) with per-module configure actions

## Usage

1. Open the **Targets** activity bar icon.
2. Use **Targets Dashboard** (or another configured dashboard) to view modules and targets.
3. Click **▶** to run a target, or click the status icon to reveal the terminal.
4. Use the toolbar to refresh, configure, run all, rerun failed, stop all, or clear task terminals.

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `targetsRunner.buildSystem` | `auto` | `auto`, `ninja`, or `make`. |
| `targetsRunner.makeJobs` | `auto` | Number of make jobs (`auto` uses CPU count). |
| `targetsRunner.maxParallel` | `4` | Maximum parallel target executions. |
| `targetsRunner.dashboards` | See `package.json` | Dashboards shown in the Embedded Targets Manager menu. |

Each dashboard supports:

- `name`: display name in the menu.
- `moduleRoots`: one or two root paths to discover modules under.
- `excludedModules`: module names to skip.
- `targets`: the target names shown in the dashboard.
