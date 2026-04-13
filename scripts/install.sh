#!/usr/bin/env bash
#
# Install agent-sentinel skills into ~/.claude/commands/
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMMANDS_DIR="$HOME/.claude/commands"

echo "Installing agent-sentinel skills..."

# Build the project first
echo "  Building TypeScript..."
cd "$PROJECT_DIR"
npm install --silent 2>/dev/null
npm run build --silent 2>/dev/null

# Create commands directory
mkdir -p "$COMMANDS_DIR"

# Resolve the absolute path to dist/index.js
SENTINEL_BIN="$(cd "$PROJECT_DIR" && pwd)/dist/index.js"

# Generate skill files with the correct absolute path
cat > "$COMMANDS_DIR/sentinel.md" << SKILLEOF
# Self-Quality Verification

Run a full diagnostic using agent-sentinel.

\`\`\`bash
node $SENTINEL_BIN scan
\`\`\`

\`\`\`bash
node $SENTINEL_BIN health
\`\`\`

If GREEN — report "Sentinel: green" and stop.
If YELLOW or RED — run the full report:

\`\`\`bash
node $SENTINEL_BIN report
\`\`\`

Then follow the behavioral corrections in SKILL.md at $PROJECT_DIR/SKILL.md
SKILLEOF

cat > "$COMMANDS_DIR/sentinel-quick.md" << SKILLEOF
# Quick Sentinel Check

\`\`\`bash
node $SENTINEL_BIN scan 2>/dev/null
node $SENTINEL_BIN health
\`\`\`

GREEN: Say "Sentinel: green" and continue.
YELLOW: Say "Sentinel: yellow" + one-line summary.
RED: Say "Sentinel: red" + list critical regressions.

Always: read before editing, grep before modifying, surgical edits only, no permission-seeking phrases.
SKILLEOF

cat > "$COMMANDS_DIR/sentinel-report.md" << SKILLEOF
# Quality Report

\`\`\`bash
node $SENTINEL_BIN scan 2>&1
node $SENTINEL_BIN report --format md
\`\`\`

Output the full markdown report. Do not summarize.
SKILLEOF

cat > "$COMMANDS_DIR/sentinel-dashboard.md" << SKILLEOF
# Quality Dashboard

\`\`\`bash
node $SENTINEL_BIN scan 2>&1
node $SENTINEL_BIN dashboard
\`\`\`

Dashboard runs at http://localhost:7847.
SKILLEOF

cat > "$COMMANDS_DIR/sentinel-prescribe.md" << SKILLEOF
# Quality Prescriptions

Analyze degraded metrics and show specific fixes (env vars, settings, CLAUDE.md rules).

\`\`\`bash
node $SENTINEL_BIN scan 2>/dev/null
node $SENTINEL_BIN prescribe
\`\`\`

Report the prescriptions to the user. If they want to apply them:

\`\`\`bash
node $SENTINEL_BIN prescribe --apply
\`\`\`

Tell the user what was written and where.
SKILLEOF

echo ""
echo "  Installed 5 skills:"
echo "    /sentinel           — Full diagnostic with corrections"
echo "    /sentinel-quick     — Fast health check"
echo "    /sentinel-report    — GitHub-postable markdown report"
echo "    /sentinel-dashboard — Web dashboard"
echo "    /sentinel-prescribe — Prescribe and apply fixes"
echo ""
echo "  Skills point to: $SENTINEL_BIN"
echo ""
echo "Done. Type /sentinel in any Claude Code session to self-check."
