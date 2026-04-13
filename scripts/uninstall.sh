#!/usr/bin/env bash
#
# Remove agent-sentinel skills from ~/.claude/commands/
#
set -euo pipefail

COMMANDS_DIR="$HOME/.claude/commands"

echo "Removing agent-sentinel skills..."

for f in sentinel.md sentinel-quick.md sentinel-report.md sentinel-dashboard.md sentinel-prescribe.md; do
  if [ -f "$COMMANDS_DIR/$f" ]; then
    rm "$COMMANDS_DIR/$f"
    echo "  Removed $f"
  fi
done

# Also remove legacy vitals skills if present
for f in vitals.md vitals-quick.md vitals-report.md vitals-dashboard.md vitals-prescribe.md; do
  if [ -f "$COMMANDS_DIR/$f" ]; then
    rm "$COMMANDS_DIR/$f"
    echo "  Removed legacy $f"
  fi
done

echo "Done."
