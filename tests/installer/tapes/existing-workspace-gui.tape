# Existing Workspace GUI Installation Test Tape
# This tape demonstrates the GUI flow for an existing workspace
# Run with: vhs tests/installer/tapes/existing-workspace-gui.tape

Output tests/installer/output/existing-workspace-gui.gif
Set FontSize 14
Set Width 120
Set Height 40

# Start the installer on existing workspace
Type "node scripts/workspace-installer.js --workspace-path ./test-workspace"
Enter
Sleep 1s

# Select action for existing workspace (reinstall)
Type "reinstall"
Enter
Sleep 500ms

# Wait for reinstallation to complete
Sleep 5s

