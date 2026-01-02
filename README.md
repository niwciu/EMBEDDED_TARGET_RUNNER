# Embedded Target Runner

A VS Code extension that discovers CMake test modules under `test/`, shows a dashboard of custom targets, and runs them through native VS Code tasks/terminals.

## Features

- Zero-config module discovery (modules under `test/<module>`)
- Targets list from `.vscode/targets.test.json` (fallback to defaults)
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
| `targetsRunner.modulesRoot` | `test` | Root folder for test modules. |
| `targetsRunner.targetsFile` | `.vscode/targets.test.json` | Targets list file. |
| `targetsRunner.buildSystem` | `auto` | `auto`, `ninja`, or `make`. |
| `targetsRunner.makeJobs` | `auto` | Number of make jobs (`auto` uses CPU count). |
| `targetsRunner.maxParallel` | `4` | Maximum parallel target executions. |

## Targets file format

`.vscode/targets.test.json`

```json
{
  "targets": [
    "format",
    "format_test",
    "run",
    "run_ctest",
    "cppcheck",
    "ccm",
    "ccc",
    "ccmr",
    "ccr",
    "ccca",
    "ccra"
  ]
}
```

If the file is missing, the extension uses the default list above.
