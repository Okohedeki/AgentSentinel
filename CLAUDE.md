# agent-sentinel

Automated quality recovery system for AI coding agents. Detects when Claude Code, Codex, or Gemini degrades mid-session, diagnoses the failure mode, and applies recovery levers. Built on [claude-vitals](https://github.com/Okohedeki/claude-vitals) and [@stellaraccident's analysis](https://github.com/anthropics/claude-code/issues/42796) of 234,760 tool calls.

## Structure

- `src/scanner/` — JSONL log parser + ingestion into SQLite
- `src/metrics/` — 20+ metric computations
- `src/regression/` — Rolling 7-day window regression detection
- `src/changes/` — Config change detection + annotations + impact analysis
- `src/reports/` — Terminal (chalk + sparklines) and Markdown reports
- `src/dashboard/` — Single HTML file + HTTP server
- `src/db/` — SQLite schema (17 tables) + query layer
- `src/watcher/` — Real-time JSONL file watching + rolling window metrics + degradation detection
- `src/context-bus/` — Shared state store for cross-agent handoffs + handoff prompt generation
- `src/config/` — Configuration types, defaults, and loader
- `src/prescriptions/` — Automated fix prescriptions (env vars, settings.json, CLAUDE.md rules)
- `scripts/` — Install/uninstall skills to ~/.claude/commands/
- `SPEC.md` — Full specification (all 20 metrics, rationale, thresholds)

## Commands

```bash
npm run build                        # tsc -> dist/
node dist/index.js scan              # Ingest session logs
node dist/index.js health            # One-line status
node dist/index.js status            # Current metrics + degradation state
node dist/index.js watch             # Real-time monitoring with degradation detection
node dist/index.js report            # Terminal report
node dist/index.js report --format md  # Markdown report
node dist/index.js dashboard         # Web dashboard
node dist/index.js prescribe         # Diagnose + prescribe fixes
node dist/index.js context show <id> # Show context bus state
node dist/index.js context handoff <id>  # Generate handoff prompt
node dist/index.js context clear <id>    # Reset context bus
```

## Rules

- This is TypeScript — `lib/__init__.py` convention does not apply
- After modifications, rebuild with `npm run build`
- Dashboard HTML is a single file with no build step — edit src/dashboard/dashboard.html directly
- The SPEC.md is the source of truth for what metrics exist and why
- Database tables prefixed with `ctx_` belong to the Context Bus
- The Watcher is real-time; the Scanner is batch — they share the same parser
