---
name: agent-sentinel
version: "0.1.0"
description: >
  Self-quality verification and recovery for AI coding agents. Scans session
  logs, computes 20+ behavioral and quality metrics, detects regressions, and
  applies corrective behaviors when performance degrades. Based on the analysis
  of 234,760 tool calls that proved reduced thinking depth causes measurable
  quality collapse.
argument-hint: |
  /sentinel              Full diagnostic with behavioral corrections
  /sentinel-quick        Fast health check, silent if green
  /sentinel-report       GitHub-postable markdown report
  /sentinel-dashboard    Launch the web dashboard
allowed-tools:
  - Bash
  - Read
user-invocable: true
homepage: https://github.com/Okohedeki/AgentSentinel
author: Built on research by @stellaraccident
license: MIT
---

# agent-sentinel

Self-quality verification for AI coding agent sessions.

You are running a diagnostic check against your own session logs. The data comes from your actual behavior — tool calls, thinking blocks, user reactions — not self-assessment.

**NOTE:** The `SENTINEL_BIN` variable below must point to the built `dist/index.js` in your AgentSentinel installation. If installed globally via npm, use `sentinel` directly. Otherwise use `node /path/to/AgentSentinel/dist/index.js`.

---

## /sentinel — Full Diagnostic

### Step 1: Scan

Ingest any new session data and compute metrics:

```bash
sentinel scan
```

### Step 2: Health Check

```bash
sentinel health
```

If GREEN — report "Sentinel: green" to the user and stop.

If YELLOW or RED — continue to Step 3.

### Step 3: Full Report

```bash
sentinel report
```

Read the output. Identify every metric in WARNING or DEGRADED range using these benchmarks:

| Metric | Good | Degraded |
|--------|------|----------|
| Read:Edit Ratio | >= 6.6 | <= 2.0 |
| Research:Mutation Ratio | >= 8.7 | <= 2.8 |
| Blind Edit Rate | <= 6.2% | >= 33.7% |
| Write vs Edit % | <= 4.9% | >= 11.1% |
| Thinking Depth (median) | >= 2,200 | <= 600 |
| Reasoning Loops / 1K | <= 8.2 | >= 26.6 |
| Laziness Violations / day | 0 | >= 10 |
| Self-Admitted Failures / 1K | <= 0.1 | >= 0.5 |
| User Interrupts / 1K | <= 0.9 | >= 11.4 |
| Sentiment Ratio | >= 4.4 | <= 3.0 |
| Frustration Rate | <= 5.8% | >= 9.8% |
| Prompts / Session | >= 35.9 | <= 27.9 |

### Step 4: Behavioral Corrections

CRITICAL: These are not suggestions. For each degraded metric, apply the correction immediately.

**Low Read:Edit Ratio (< 4.0):**
Before ANY edit, read the target file AND at least 2 related files. No exceptions.

**Low Research:Mutation Ratio (< 5.0):**
Before any code change: Grep for the symbol being modified, Glob for related files, Read each file you'll touch.

**High Blind Edit Rate (> 15%):**
For EVERY edit, verify: "Have I Read this exact file in the last 10 tool calls?" If not, Read it now.

**High Write vs Edit % (> 8%):**
Never use Write/CreateFile to modify existing files. Use Edit for surgical changes. Write is only for new files.

**Low Thinking Depth:**
Before answering, think through: What could go wrong? What am I assuming? What haven't I checked?

**High Reasoning Loops (> 12/1K):**
You're self-correcting visibly. Resolve contradictions internally before producing output.

**Laziness Violations (> 3/day):**
BANNED PHRASES: "should I continue?", "want me to keep going?", "shall I proceed?", "good stopping point", "let's pause here", "out of scope for now", "continue in a new session". Do the work.

**High Self-Admitted Failures:**
Read more before editing. Test after changing. Don't move on until each change is verified.

**High User Interrupts:**
Slow down. Read more context. Make smaller, verifiable changes.

**Low Sentiment / High Frustration:**
Be more thorough. Read before editing. Don't skip steps. Don't produce partial work.

### Step 4.5: Configuration Prescriptions

If any metric is in WARNING or DEGRADED range, check for config-level fixes:

```bash
sentinel prescribe
```

This outputs specific environment variables, settings.json values, and CLAUDE.md rules to fix the degraded metrics. Report these to the user.

If they agree, apply automatically:

```bash
sentinel prescribe --apply
```

This writes the fixes to `~/.claude/settings.json` and `~/.claude/CLAUDE.md`. The impact can be measured after 7 days with `sentinel impact`.

### Step 5: Report to User

Tell the user directly:
1. Health status (green/yellow/red)
2. How many of the 20 metrics are good/warning/degraded
3. Which behaviors you are correcting
4. Top 3 metrics needing improvement

Be direct. If you're degraded, say so.

---

## /sentinel-quick — Fast Check

Silent self-check. Only speak up if something is wrong.

```bash
sentinel scan 2>/dev/null
sentinel health
```

- GREEN: Say "Sentinel: green" and move on.
- YELLOW: Say "Sentinel: yellow" + one-line summary. Apply corrections silently.
- RED: Say "Sentinel: red" + list critical regressions. Ask user if they want full `/sentinel` or to continue with corrections applied.

Regardless of status, always apply baseline behaviors:
- Read every file before editing it
- Grep for symbol usages before modifying anything
- Never ask permission to stop
- Make surgical edits, not full-file rewrites
- Don't stop until the task is complete

---

## /sentinel-report — Markdown Report

Generate a GitHub-postable quality report:

```bash
sentinel scan 2>&1
sentinel report --format md
```

Output the full markdown. Do not summarize or abbreviate.

---

## /sentinel-dashboard — Web Dashboard

Launch the interactive dashboard:

```bash
sentinel scan 2>&1
sentinel dashboard
```

Tell the user the dashboard is at http://localhost:7847.
