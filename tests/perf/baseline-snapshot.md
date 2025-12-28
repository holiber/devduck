# Installer Tests Baseline

**Captured:** 2025-12-28T01:27:08.404Z  
**Total Duration:** 0.47s  
**Total Tests:** 34  
**Total Suites:** 12

## All Test Timings (sorted by duration)

| Test Name | Duration (ms) |
|-----------|---------------|
| Step 6: Setup Projects | 1.66 |
| Verify scripts do not change current directory | 1.83 |
| Install additional scripts via importScripts | 2.07 |
| Remove scripts when project is removed from config | 2.16 |
| Handle missing project package.json gracefully | 2.23 |
| Step 2: Download Repos | 3.14 |
| Install default scripts from project | 3.29 |
| Step 3: Download Projects | 3.88 |
| Step 4: Check Environment Again | 11.33 |
| Step 5: Setup Modules | 14.32 |
| Step 7: Verify Installation | 15.98 |
| modules: ["issue-*"] expands to issue-tracker and issue-tracker-github | 17.03 |
| Step 1: Check Environment Variables | 43.70 |
| Unattended Installation - Full Structure Verification | 385.38 |
| installer: .env values are available to shell checks (fill-missing) | 449.29 |
| Installs module from workspace/modules when listed in config | 474.07 |
| installer summary: prints INSTALLATION FINISHED WITH ERRORS on failures | 479.34 |
| Unattended Installation - Fresh Workspace | 479.58 |
| GUI Installation - Fresh Workspace | 494.55 |
| installer: checks without name do not print "Checking undefined" | 496.98 |
| Unattended Installation with Config File | 497.19 |
| Unattended Installation with workspace.config.json seedFiles[] copies seed files/folders | 503.33 |
| Detect Existing Workspace | 516.68 |
| Unattended Installation with workspace.config.json (local folder project src) | 541.34 |
| Unattended Installation from fixture - cursor-only | 569.82 |
| installer: hook load failure is fatal | 588.88 |
| Reinstall Existing Workspace - Unattended | 759.64 |
| Reinstallation Verification - Preserve Configuration | 827.65 |
| Reinstallation - Module Hooks Re-executed | 866.37 |
| Add Modules to Existing Workspace | 918.32 |
| Remove Modules from Existing Workspace | 939.62 |
| Installation with External Repository | 1056.74 |
| resolves relative workspace path from INIT_CWD (npx cache cwd simulation) | 2753.39 |
| clones DevDuck into devduck/src when not listed in projects | 4293.26 |

## Fastest 20% (7 tests) - Smoke Group

These are the fastest 7 tests (top 20%), frozen for smoke testing:

1. **Step 6: Setup Projects** - 1.66ms
2. **Verify scripts do not change current directory** - 1.83ms
3. **Install additional scripts via importScripts** - 2.07ms
4. **Remove scripts when project is removed from config** - 2.16ms
5. **Handle missing project package.json gracefully** - 2.23ms
6. **Step 2: Download Repos** - 3.14ms
7. **Install default scripts from project** - 3.29ms
