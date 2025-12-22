# Fresh Workspace GUI Installation Test Tape
# This tape demonstrates the GUI installation flow for a fresh workspace
# Run with: vhs tests/installer/tapes/fresh-workspace-gui.tape

Output tests/installer/output/fresh-workspace-gui.gif
Set FontSize 14
Set Width 120
Set Height 40

# Start the installer
Type "node scripts/workspace-installer.js"
Enter
Sleep 1s

# Select AI agent (cursor)
Type "cursor"
Enter
Sleep 500ms

# Select repository type (none - no repository)
Type "none"
Enter
Sleep 500ms

# Wait for module selection (default selection, just press Enter)
Enter
Sleep 2s

# Wait for installation to complete
Sleep 5s

