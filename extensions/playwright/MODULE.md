---
name: playwright
version: 0.1.0
description: Testing utilities and guidelines for barducks modules
tags: [testing, e2e, cli]
dependencies: [core]
---
# Playwright Module

Module providing testing utilities and guidelines for barducks modules and installer.

## Automatic Setup

When the `playwright` module is installed in a workspace, it automatically:
- Adds VHS scripts (`vhs`, `vhs:fresh`, `vhs:existing`) to the workspace's `package.json`
- Creates `package.json` if it doesn't exist
- Updates existing scripts if they differ from the module's defaults

## CLI-GUI Testing with VHS

When testing CLI-GUI applications (interactive terminal interfaces), use [charmbracelet/vhs](https://github.com/charmbracelet/vhs) for terminal recording and playback.

### Why VHS?

VHS allows creating `.tape` files that record terminal interactions in a declarative format. This enables:
- Reproducible terminal interaction tests
- Version-controlled test scenarios
- Easy maintenance of GUI test cases
- Cross-platform compatibility

### Usage

1. **Install VHS:**
   ```bash
   brew install vhs  # macOS
   # or download from https://github.com/charmbracelet/vhs/releases
   ```

2. **Create a tape file** (`.tape`):
   ```tape
   Output tests/installer/output.gif
   Set FontSize 14
   
   Type "node scripts/workspace-installer.js"
   Enter
   Sleep 500ms
   
   Type "cursor"
   Enter
   Sleep 500ms
   
   Type "none"
   Enter
   ```

3. **Run the tape:**
   ```bash
   # Using npm scripts (recommended)
   # Note: These scripts are automatically added to workspace package.json when playwright module is installed
   npm run vhs                # Run fresh workspace GUI tape (default)
   npm run vhs:fresh          # Run fresh workspace GUI tape
   npm run vhs:existing       # Run existing workspace GUI tape
   
   # Or directly with vhs
   vhs tests/installer/tapes/fresh-workspace-gui.tape
   vhs tests/installer/tapes/existing-workspace-gui.tape
   ```

4. **View the generated output:**
   After running a tape, VHS generates a GIF file showing the terminal interaction.
   ```bash
   # The output GIF is saved to the path specified in the tape file
   # For example: tests/installer/output/fresh-workspace-gui.gif
   open tests/installer/output/fresh-workspace-gui.gif  # macOS
   # or
   xdg-open tests/installer/output/fresh-workspace-gui.gif  # Linux
   ```

5. **Use in tests:**
   - Record expected terminal interactions as `.tape` files
   - Playback tapes during tests to verify GUI behavior
   - Compare actual output with expected output
   - Review generated GIFs to visually verify terminal interactions

### Best Practices

- Keep tape files simple and focused on specific user flows
- Use descriptive names for tape files (e.g., `fresh-workspace-gui.tape`)
- Store tapes in `tests/installer/tapes/` directory
- Document complex interactions in comments within tape files
- Use appropriate sleep durations to account for async operations
- Generated GIF files are automatically ignored by `.gitignore` and `.arcignore`

### References

- VHS Documentation: https://github.com/charmbracelet/vhs
- VHS Examples: https://github.com/charmbracelet/vhs/tree/main/examples

## Testing Guidelines

- Use `node:test` for unit and integration tests (built-in, no dependencies)
- Use VHS for CLI-GUI interaction testing
- Ensure test isolation by using temporary directories
- Clean up test artifacts after each test
- Verify both success and error scenarios

