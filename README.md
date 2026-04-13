# agent-sentinel

Automated quality recovery system for AI coding agents.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

AI coding quality degrades silently. By the time you notice, it's been broken for weeks. [@stellaraccident](https://github.com/stellaraccident) proved this across [234,760 tool calls](https://github.com/anthropics/claude-code/issues/42796) — thinking depth had dropped 67% before anyone noticed, blind edits tripled, and costs spiraled from $12/day to $1,504/day.

AgentSentinel makes that analysis continuous and automatic. It watches your session logs in real time, computes 20+ quality metrics, detects degradation, and provides the infrastructure for automated recovery — including cross-agent context handoffs.

## Quick Start

```bash
git clone https://github.com/Okohedeki/AgentSentinel.git
cd AgentSentinel && npm install && npm run build
```

### 1. Scan existing sessions
```
sentinel scan && sentinel health
```

### 2. See current quality
```
sentinel status
```

### 3. Watch live (real-time monitoring + context bus population)
```
sentinel watch --verbose
```

### 4. Generate a handoff prompt for agent switching
```
sentinel context show <session-id>
sentinel context handoff <session-id>
```

### 5. Get automated fix prescriptions
```
sentinel prescribe
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     AGENT SENTINEL                          │
│                                                             │
│  ┌──────────────┐    ┌───────────────┐    ┌─────────────┐  │
│  │  WATCHER     │    │  CONTEXT BUS  │    │  RECOVERY   │  │
│  │              │───▶│               │───▶│  ENGINE     │  │
│  │ reads JSONL  │    │ shared state  │    │             │  │
│  │ computes     │    │ across agents │    │ applies     │  │
│  │ metrics      │    │               │    │ levers      │  │
│  └──────────────┘    └───────────────┘    └─────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

- **Watcher** — Real-time chokidar-based file watching of `~/.claude/projects/**/*.jsonl`. Computes metrics on a rolling window. Emits degradation events when thresholds are crossed.
- **Context Bus** — SQLite-backed shared state store. Tracks file operations, tool call cache, decisions, and agent history. Generates structured handoff prompts for seamless agent switching.
- **Recovery Engine** — Prescriptions system that diagnoses degraded metrics and applies fixes (env vars, settings.json, CLAUDE.md rules). Model switching and harness hardening planned for v0.2.

## Commands

| Command | Description |
|---|---|
| `sentinel scan` | Ingest session logs into SQLite + populate context bus |
| `sentinel health` | One-line green/yellow/red status |
| `sentinel status` | Current metrics with trends and alerts |
| `sentinel watch` | Real-time monitoring with degradation detection |
| `sentinel report` | Terminal report with sparklines and trends |
| `sentinel report --format md` | GitHub-postable markdown report |
| `sentinel prescribe` | Diagnose and prescribe fixes |
| `sentinel prescribe --apply` | Write fixes to settings.json and CLAUDE.md |
| `sentinel dashboard` | Launch web dashboard at localhost:7847 |
| `sentinel compare <p1> <p2>` | Side-by-side period comparison |
| `sentinel context show <id>` | Show context bus state for a session |
| `sentinel context handoff <id>` | Generate handoff prompt for agent switching |
| `sentinel context clear <id>` | Reset context bus for a session |
| `sentinel annotate <desc>` | Log a manual change event |
| `sentinel impact <change-id>` | Before/after metrics for a change |

## Metrics

20+ metrics computed from session logs, based on the [original analysis](https://github.com/anthropics/claude-code/issues/42796):

| Metric | Good | Degraded | Why It Matters |
|--------|------|----------|----------------|
| Read:Edit Ratio | >= 6.6 | <= 2.0 | Research before acting |
| Thinking Depth | >= 2,200 | <= 600 | Deep analysis vs shortcuts |
| Blind Edit Rate | <= 6.2% | >= 33.7% | Editing files never read |
| Laziness Violations | 0/day | >= 10/day | Stop-hook / permission-seeking |
| Tool Success Rate | >= 95% | <= 80% | Bash/tool call failures |
| Session Autonomy | >= 10 min | <= 3 min | Time between human interventions |
| Frustration Rate | <= 5.8% | >= 9.8% | User frustration signals |
| Sentiment Ratio | >= 4.4 | <= 3.0 | Positive vs negative user words |

Plus: research:mutation ratio, write vs edit %, first-tool-read %, reasoning loops, self-admitted failures, user interrupts, edit churn, subagent %, context pressure, cost estimates, time-of-day quality, tool diversity, token efficiency, session length.

## Context Bus

The context bus solves the handoff problem. When you need to switch agents mid-task:

```bash
# See what the current agent has done
sentinel context show <session-id>

# Generate a prompt for the next agent
sentinel context handoff <session-id>
```

The handoff prompt includes:
- Files touched (read/edit/create) with reasons
- Cached tool call results (so the next agent doesn't re-call)
- Decisions made with rationale
- Task state (completed steps, remaining steps, blockers)

## Skills

Install Claude Code skills for in-session self-checks:

```bash
bash scripts/install.sh
```

This adds `/sentinel`, `/sentinel-quick`, `/sentinel-report`, `/sentinel-dashboard`, `/sentinel-prescribe` to `~/.claude/commands/`.

## Built On

- [claude-vitals](https://github.com/Okohedeki/claude-vitals) — the original monitoring CLI
- [@stellaraccident's analysis](https://github.com/anthropics/claude-code/issues/42796) of 234,760 tool calls proving thinking depth collapse

## License

MIT
