# Embedded Project Manager

A VS Code extension that discovers CMake test modules under `test/`, shows a dashboard of custom targets, and runs them through native VS Code tasks/terminals.

## Features

- Zero-config module discovery (modules under `test/<module>`)
- Targets list from `epm_targets_lists.json` (fallback to defaults)
- Parallel execution with controlled concurrency
- Native terminal output with clickable file:line:column links
- Status dashboard (⏳ ✓ ✗ -)

## Usage

1. Open the **Targets** activity bar icon.
2. Use **Targets Dashboard** to view modules and targets.
3. Click **▶** to run a target, or click the status icon to reveal the terminal.
4. Use the toolbar to refresh, run all, rerun failed, or stop all.

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `targetsRunner.testModulesRoot` | `test` | Root folder for test modules. |
| `targetsRunner.modulesRoot` | `test` | Deprecated. Use `targetsRunner.testModulesRoot` instead. |
| `targetsRunner.hwConfigurationsRoot` | `hw` | Root folder for HW configurations. |
| `targetsRunner.hwTestRoot` | `test/hw_test` | Root folder for HW tests. |
| `targetsRunner.targetsFile` | `epm_targets_lists.json` | Targets list file. |
| `targetsRunner.buildSystem` | `auto` | `auto`, `ninja`, or `make`. |
| `targetsRunner.makeJobs` | `auto` | Number of make jobs (`auto` uses CPU count). |
| `targetsRunner.maxParallel` | `4` | Maximum parallel target executions. |

## Targets file format

`epm_targets_lists.json`

```json
{
  "test": [
    "run"
  ],
  "all_test_targets": [
    "format",
    "format_test",
    "all",
    "run",
    "cppcheck",
    "ccm",
    "ccc",
    "ccmr",
    "ccr",
    "ccca",
    "ccra"
  ],
  "hw": ["all", "flash", "reset", "erase"],
  "hw_test": ["all", "flash", "reset", "erase"],
  "ci": ["run", "cppcheck", "ccm", "ccc", "format_check"],
  "reports": ["ccr", "ccmr"],
  "format": ["format", "format_test"]
}
```

If the file is missing, the extension uses the default lists above for each dashboard.
