## Baseline (pre-migration)
- **All tests (current runner)**: measured=34143ms; reported=33570.843ms
- **Installer-only (current runner)**: measured=16778ms; reported=16476.225ms
### Fastest 20% (installer-only)
Frozen list: `installer.fastest20.json` (count=7).
Top entries (sorted):
- 1.256ms — Installation Steps > Step 6: Setup Projects
- 1.419ms — Install Project Scripts > Handle missing project package.json gracefully
- 1.477ms — Install Project Scripts > Remove scripts when project is removed from config
- 1.852ms — Installation Steps > Step 3: Download Projects
- 2.389ms — Install Project Scripts > Install additional scripts via importScripts
- 3.181ms — Install Project Scripts > Install default scripts from project
- 3.906ms — Install Project Scripts > Verify scripts do not change current directory
