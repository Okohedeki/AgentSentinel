#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { SentinelDB } from './db/database';
import { Scanner } from './scanner/scanner';
import { MetricsAnalyzer } from './metrics/analyzer';
import { ChangeTracker } from './changes/tracker';
import { RegressionDetector } from './regression/detector';
import { TerminalReport } from './reports/terminal';
import { MarkdownReport } from './reports/markdown';
import { serveDashboard } from './dashboard/server';
import { Prescriber } from './prescriptions/prescriber';
import { SessionWatcher } from './watcher/watcher';
import { ContextBus } from './context-bus/context-bus';
import { loadConfig } from './config/loader';

const program = new Command();

program
  .name('sentinel')
  .description('Automated quality recovery system for AI coding agents')
  .version('0.1.0');

// --- scan ---
program
  .command('scan')
  .description('Ingest Claude Code session logs into the database')
  .option('-f, --force', 'Re-scan all sessions, even previously scanned ones')
  .option('-v, --verbose', 'Show detailed progress')
  .option('--db <path>', 'Custom database path')
  .action((opts) => {
    const db = new SentinelDB(opts.db);
    try {
      console.log(chalk.bold('Scanning Claude Code session logs...\n'));

      const scanner = new Scanner(db);
      const result = scanner.scan({ force: opts.force, verbose: opts.verbose });

      console.log(chalk.green(`\n✓ Scanned: ${result.scanned} sessions`));
      if (result.skipped > 0) console.log(chalk.gray(`  Skipped: ${result.skipped} (already scanned)`));
      if (result.errors > 0) console.log(chalk.yellow(`  Errors: ${result.errors}`));

      // Detect config changes
      console.log(chalk.bold('\nChecking for config changes...'));
      const tracker = new ChangeTracker(db);
      const changes = tracker.detectChanges();
      if (changes > 0) {
        console.log(chalk.green(`  Detected ${changes} config change(s)`));
      } else {
        console.log(chalk.gray('  No config changes detected'));
      }

      // Compute metrics
      console.log(chalk.bold('\nComputing metrics...'));
      const analyzer = new MetricsAnalyzer();
      analyzer.computeAll(db);
      console.log(chalk.green('✓ Metrics computed'));

      const totalSessions = db.getSessionCount();
      const totalToolCalls = db.getToolCallCount();
      console.log(chalk.bold(`\nTotal: ${totalSessions} sessions, ${totalToolCalls.toLocaleString()} tool calls in database`));
    } finally {
      db.close();
    }
  });

// --- report ---
program
  .command('report')
  .description('Generate a quality report')
  .option('-d, --days <number>', 'Number of days to include', '30')
  .option('-f, --format <format>', 'Output format: terminal or md', 'terminal')
  .option('-m, --model <model>', 'Filter by model')
  .option('-p, --project <project>', 'Filter by project')
  .option('--db <path>', 'Custom database path')
  .action((opts) => {
    const db = new SentinelDB(opts.db);
    try {
      if (opts.format === 'md' || opts.format === 'markdown') {
        const report = new MarkdownReport(db);
        console.log(report.generate({ days: parseInt(opts.days) }));
      } else {
        const report = new TerminalReport(db);
        report.generate({ days: parseInt(opts.days), model: opts.model, project: opts.project });
      }
    } finally {
      db.close();
    }
  });

// --- health ---
program
  .command('health')
  .description('One-line health status')
  .option('--db <path>', 'Custom database path')
  .action((opts) => {
    const db = new SentinelDB(opts.db);
    try {
      const detector = new RegressionDetector(db);
      const health = detector.getHealthStatus();

      const icon = health.status === 'green' ? '🟢' : health.status === 'yellow' ? '🟡' : '🔴';
      const colorFn = health.status === 'green' ? chalk.green : health.status === 'yellow' ? chalk.yellow : chalk.red;
      console.log(`${icon} ${colorFn(health.message)}`);

      if (health.alerts.length > 0) {
        console.log('');
        for (const alert of health.alerts) {
          const colorFn = alert.severity === 'critical' ? chalk.red : chalk.yellow;
          console.log(`  ${colorFn(alert.message)}`);
        }
        console.log('');
        console.log(chalk.gray('  Run "sentinel prescribe" for specific fixes.'));
      }
    } finally {
      db.close();
    }
  });

// --- baseline ---
program
  .command('baseline')
  .description('Show recommended baseline settings for optimal Claude Code quality')
  .option('--apply', 'Write baseline settings to ~/.claude/settings.json')
  .option('--db <path>', 'Custom database path')
  .action((opts) => {
    const prescriber = new Prescriber(new SentinelDB(opts.db));
    const baselines = prescriber.getBaselineRecommendations();

    console.log(chalk.bold('\n  BASELINE SETTINGS FOR OPTIMAL QUALITY\n'));
    console.log(chalk.gray('  These settings should be applied regardless of current metrics.\n'));

    for (const b of baselines) {
      const typeColor = b.type === 'env_var' ? chalk.cyan : b.type === 'settings_json' ? chalk.magenta : chalk.yellow;
      const typeLabel = b.type === 'env_var' ? 'ENV' : b.type === 'settings_json' ? 'settings.json' : 'permissions';
      console.log(`  ${typeColor(typeLabel.padEnd(14))} ${chalk.white(b.key)} = ${chalk.green(String(b.value))}`);
      console.log(`  ${' '.repeat(14)} ${chalk.gray(b.description)}`);
      console.log('');
    }

    if (opts.apply) {
      // Build a fake prescription list to reuse the apply logic
      const fakePrescriptions = baselines.map(b => ({
        metric: 'baseline',
        metricLabel: 'Baseline',
        currentValue: 0,
        threshold: 0,
        severity: 'warning' as const,
        fix: b,
      }));
      const result = prescriber.apply(fakePrescriptions, { target: 'global' });
      console.log(chalk.green.bold('  APPLIED\n'));
      if (result.settingsWritten) {
        console.log(chalk.green(`  ✓ Settings written to ${result.settingsPath}`));
      }
      console.log('');
    } else {
      console.log(chalk.gray('  TO APPLY:'));
      console.log(chalk.white('    sentinel baseline --apply'));
      console.log('');
    }
  });

// --- prescribe ---
program
  .command('prescribe')
  .description('Analyze metrics and prescribe specific fixes (env vars, settings, CLAUDE.md rules)')
  .option('--apply', 'Actually write the fixes (default: dry-run showing recommendations)')
  .option('--target <scope>', 'Where to apply: global (~/.claude/) or project (.claude/)', 'global')
  .option('-f, --format <format>', 'Output format: terminal, json, or md', 'terminal')
  .option('--db <path>', 'Custom database path')
  .action((opts) => {
    const db = new SentinelDB(opts.db);
    try {
      const prescriber = new Prescriber(db);
      const prescriptions = prescriber.diagnose();

      if (prescriptions.length === 0) {
        console.log(chalk.green('✓ No prescriptions needed — all metrics within acceptable ranges.'));
        return;
      }

      if (opts.format === 'json') {
        console.log(JSON.stringify(prescriptions, null, 2));
        return;
      }

      if (opts.format === 'md' || opts.format === 'markdown') {
        const lines: string[] = [];
        lines.push('# Quality Prescriptions');
        lines.push('');
        const criticals = prescriptions.filter(p => p.severity === 'critical');
        const warnings = prescriptions.filter(p => p.severity === 'warning');

        if (criticals.length > 0) {
          lines.push('## Critical Fixes');
          lines.push('');
          const seen = new Set<string>();
          for (const p of criticals) {
            const key = `${p.metric}:${p.fix.key}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const typeLabel = p.fix.type === 'env_var' ? 'ENV' : p.fix.type === 'settings_json' ? 'settings.json' : 'CLAUDE.md';
            lines.push(`- **${p.metricLabel}** at ${p.currentValue} (threshold: ${p.threshold})`);
            lines.push(`  - \`${typeLabel}\`: ${p.fix.type === 'claude_md' ? p.fix.description : `${p.fix.key} = ${p.fix.value}`}`);
          }
          lines.push('');
        }

        if (warnings.length > 0) {
          lines.push('## Warnings');
          lines.push('');
          const seen = new Set<string>();
          for (const p of warnings) {
            const key = `${p.metric}:${p.fix.key}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const typeLabel = p.fix.type === 'env_var' ? 'ENV' : p.fix.type === 'settings_json' ? 'settings.json' : 'CLAUDE.md';
            lines.push(`- **${p.metricLabel}** at ${p.currentValue} (threshold: ${p.threshold})`);
            lines.push(`  - \`${typeLabel}\`: ${p.fix.type === 'claude_md' ? p.fix.description : `${p.fix.key} = ${p.fix.value}`}`);
          }
          lines.push('');
        }

        console.log(lines.join('\n'));
        return;
      }

      // Terminal format
      const criticals = prescriptions.filter(p => p.severity === 'critical');
      const warnings = prescriptions.filter(p => p.severity === 'warning');
      const uniqueMetrics = new Set(prescriptions.map(p => p.metric));

      console.log(chalk.bold('\n  PRESCRIPTIONS\n'));
      console.log(chalk.gray(`  ${uniqueMetrics.size} metrics degraded: ${criticals.length > 0 ? chalk.red(`${new Set(criticals.map(p => p.metric)).size} critical`) : ''}${criticals.length > 0 && warnings.length > 0 ? ', ' : ''}${warnings.length > 0 ? chalk.yellow(`${new Set(warnings.map(p => p.metric)).size} warning`) : ''}`));
      console.log('');

      let num = 0;
      const printedMetrics = new Set<string>();

      // Print critical fixes first
      if (criticals.length > 0) {
        console.log(chalk.red.bold('  CRITICAL FIXES\n'));
        for (const p of criticals) {
          if (printedMetrics.has(`${p.metric}:${p.fix.key}`)) continue;
          printedMetrics.add(`${p.metric}:${p.fix.key}`);
          num++;

          if (!printedMetrics.has(p.metric)) {
            console.log(chalk.white(`  ${num}. ${p.metricLabel} at ${chalk.red(String(p.currentValue))} (threshold: ${p.threshold})\n`));
          }

          const typeColor = p.fix.type === 'env_var' ? chalk.cyan : p.fix.type === 'settings_json' ? chalk.magenta : chalk.yellow;
          const typeLabel = p.fix.type === 'env_var' ? 'ENV' : p.fix.type === 'settings_json' ? 'settings.json' : 'CLAUDE.md';

          if (p.fix.type === 'claude_md') {
            console.log(`     ${typeColor(typeLabel)}: ${p.fix.description}`);
          } else {
            console.log(`     ${typeColor(typeLabel)}: ${p.fix.key} = ${chalk.white(String(p.fix.value))}`);
          }
        }
        console.log('');
      }

      // Print warnings
      if (warnings.length > 0) {
        console.log(chalk.yellow.bold('  WARNING FIXES\n'));
        for (const p of warnings) {
          if (printedMetrics.has(`${p.metric}:${p.fix.key}`)) continue;
          printedMetrics.add(`${p.metric}:${p.fix.key}`);
          num++;

          const typeColor = p.fix.type === 'env_var' ? chalk.cyan : p.fix.type === 'settings_json' ? chalk.magenta : chalk.yellow;
          const typeLabel = p.fix.type === 'env_var' ? 'ENV' : p.fix.type === 'settings_json' ? 'settings.json' : 'CLAUDE.md';

          console.log(chalk.white(`  ${num}. ${p.metricLabel} at ${chalk.yellow(String(p.currentValue))} (threshold: ${p.threshold})`));
          if (p.fix.type === 'claude_md') {
            console.log(`     ${typeColor(typeLabel)}: ${p.fix.description}`);
          } else {
            console.log(`     ${typeColor(typeLabel)}: ${p.fix.key} = ${chalk.white(String(p.fix.value))}`);
          }
        }
        console.log('');
      }

      // Apply or show instructions
      if (opts.apply) {
        const result = prescriber.apply(prescriptions, { target: opts.target });
        console.log(chalk.green.bold('  APPLIED\n'));
        if (result.settingsWritten) {
          console.log(chalk.green(`  ✓ Settings written to ${result.settingsPath}`));
          if (result.envVarsCount > 0) console.log(chalk.gray(`    ${result.envVarsCount} environment variable(s)`));
          if (result.settingsCount > 0) console.log(chalk.gray(`    ${result.settingsCount} setting(s)`));
        }
        if (result.claudeMdWritten) {
          console.log(chalk.green(`  ✓ Rules written to ${result.claudeMdPath}`));
          console.log(chalk.gray(`    ${result.claudeMdRulesCount} behavioral rule(s)`));
        }
        console.log('');
        console.log(chalk.gray('  Run "sentinel impact" after 7 days to measure the effect.'));
      } else {
        console.log(chalk.gray('  TO APPLY:'));
        console.log(chalk.white(`    sentinel prescribe --apply                # writes to ~/.claude/`));
        console.log(chalk.white(`    sentinel prescribe --apply --target project  # writes to .claude/`));
      }
      console.log('');
    } finally {
      db.close();
    }
  });

// --- dashboard ---
program
  .command('dashboard')
  .description('Launch the web dashboard')
  .option('-p, --port <number>', 'Port number', '7847')
  .option('--db <path>', 'Custom database path')
  .action((opts) => {
    const db = new SentinelDB(opts.db);
    serveDashboard(db, parseInt(opts.port));
  });

// --- compare ---
program
  .command('compare')
  .description('Compare two time periods side by side')
  .argument('<period1>', 'First period (e.g., 2024-01-01:2024-01-07)')
  .argument('<period2>', 'Second period (e.g., 2024-01-08:2024-01-14)')
  .option('--db <path>', 'Custom database path')
  .action((period1, period2, opts) => {
    const db = new SentinelDB(opts.db);
    try {
      const [start1, end1] = period1.split(':');
      const [start2, end2] = period2.split(':');

      if (!start1 || !end1 || !start2 || !end2) {
        console.error(chalk.red('Periods must be in format YYYY-MM-DD:YYYY-MM-DD'));
        process.exit(1);
      }

      const metrics = [
        'read_edit_ratio', 'thinking_depth_median', 'blind_edit_rate', 'laziness_total',
        'sentiment_ratio', 'frustration_rate', 'session_autonomy_median', 'bash_success_rate',
        'research_mutation_ratio', 'write_vs_edit_pct', 'reasoning_loops_per_1k',
        'self_admitted_failures_per_1k', 'user_interrupts_per_1k', 'edit_churn_rate',
        'subagent_pct', 'cost_estimate', 'prompts_per_session', 'first_tool_read_pct',
        'thinking_depth_redacted_pct', 'context_pressure'
      ];

      console.log(chalk.bold('\n  PERIOD COMPARISON\n'));
      console.log(chalk.gray(`  Period 1: ${start1} → ${end1}`));
      console.log(chalk.gray(`  Period 2: ${start2} → ${end2}\n`));

      const header = `  ${'Metric'.padEnd(32)} ${'Period 1'.padStart(10)} ${'Period 2'.padStart(10)} ${'Change'.padStart(10)}`;
      console.log(chalk.bold(header));
      console.log(chalk.gray('  ' + '─'.repeat(66)));

      for (const metric of metrics) {
        const data1 = db.getMetricForDateRange(metric, start1, end1);
        const data2 = db.getMetricForDateRange(metric, start2, end2);

        const avg1 = data1.length > 0 ? data1.reduce((s, d) => s + d.value, 0) / data1.length : 0;
        const avg2 = data2.length > 0 ? data2.reduce((s, d) => s + d.value, 0) / data2.length : 0;

        const changePct = avg1 !== 0 ? ((avg2 - avg1) / avg1 * 100) : 0;
        const changeStr = changePct > 0 ? `+${changePct.toFixed(1)}%` : `${changePct.toFixed(1)}%`;

        const higherIsBetter = ['read_edit_ratio', 'thinking_depth_median', 'sentiment_ratio',
          'session_autonomy_median', 'bash_success_rate', 'prompts_per_session',
          'research_mutation_ratio', 'first_tool_read_pct'].includes(metric);

        const isGood = higherIsBetter ? changePct > 5 : changePct < -5;
        const isBad = higherIsBetter ? changePct < -5 : changePct > 5;
        const colorFn = isGood ? chalk.green : isBad ? chalk.red : chalk.gray;

        const name = metric.replace(/_/g, ' ').padEnd(32);
        console.log(`  ${name} ${avg1.toFixed(1).padStart(10)} ${avg2.toFixed(1).padStart(10)} ${colorFn(changeStr.padStart(10))}`);
      }
      console.log('');
    } finally {
      db.close();
    }
  });

// --- annotate ---
program
  .command('annotate')
  .description('Log a manual change event')
  .argument('<description>', 'Description of the change')
  .option('--db <path>', 'Custom database path')
  .action((description, opts) => {
    const db = new SentinelDB(opts.db);
    try {
      const tracker = new ChangeTracker(db);
      tracker.addAnnotation(description);
      console.log(chalk.green(`✓ Annotation logged: "${description}"`));
    } finally {
      db.close();
    }
  });

// --- impact ---
program
  .command('impact')
  .description('Show before/after metrics for a specific change')
  .argument('<change-id>', 'Change ID (from report or annotate)')
  .option('--db <path>', 'Custom database path')
  .action((changeId, opts) => {
    const db = new SentinelDB(opts.db);
    try {
      const tracker = new ChangeTracker(db);
      const impact = tracker.computeImpact(parseInt(changeId));

      if (!impact) {
        console.log(chalk.red('Change not found'));
        process.exit(1);
      }

      console.log(chalk.bold(`\n  IMPACT ANALYSIS — Change #${changeId}\n`));
      console.log(chalk.gray(`  "${impact.description}" (${impact.timestamp})\n`));

      const header = `  ${'Metric'.padEnd(28)} ${'Before'.padStart(10)} ${'After'.padStart(10)} ${'Change'.padStart(10)} ${'Verdict'.padStart(10)}`;
      console.log(chalk.bold(header));
      console.log(chalk.gray('  ' + '─'.repeat(72)));

      let improved = 0, degraded = 0, stable = 0;

      for (const r of impact.results) {
        const changeStr = r.changePct > 0 ? `+${r.changePct.toFixed(1)}%` : `${r.changePct.toFixed(1)}%`;
        const verdictColor = r.verdict === 'improved' ? chalk.green : r.verdict === 'degraded' ? chalk.red : chalk.gray;

        const name = r.metric.replace(/_/g, ' ').padEnd(28);
        console.log(`  ${name} ${r.before.toFixed(1).padStart(10)} ${r.after.toFixed(1).padStart(10)} ${changeStr.padStart(10)} ${verdictColor(r.verdict.padStart(10))}`);

        if (r.verdict === 'improved') improved++;
        else if (r.verdict === 'degraded') degraded++;
        else stable++;
      }

      console.log('');
      const total = improved + degraded + stable;
      if (degraded === 0 && improved > 0) {
        console.log(chalk.green(`  ✓ This change IMPROVED quality across ${improved}/${total} key metrics`));
      } else if (improved === 0 && degraded > 0) {
        console.log(chalk.red(`  ✗ This change DEGRADED quality across ${degraded}/${total} key metrics`));
      } else {
        console.log(chalk.yellow(`  ~ Mixed impact: ${improved} improved, ${degraded} degraded, ${stable} stable`));
      }
      console.log('');
    } finally {
      db.close();
    }
  });

// --- list changes ---
program
  .command('changes')
  .description('List all tracked changes')
  .option('--db <path>', 'Custom database path')
  .action((opts) => {
    const db = new SentinelDB(opts.db);
    try {
      const changes = db.getAllChanges();
      if (changes.length === 0) {
        console.log(chalk.gray('No changes tracked yet. Run "sentinel scan" or "sentinel annotate"'));
        return;
      }

      console.log(chalk.bold('\n  TRACKED CHANGES\n'));
      for (const c of changes) {
        const typeColor = c.type === 'auto' ? chalk.blue : chalk.magenta;
        console.log(`  ${chalk.gray(`#${c.id}`)} ${typeColor(`[${c.type}]`)} ${c.description} ${chalk.gray(c.timestamp)}`);
      }
      console.log('');
    } finally {
      db.close();
    }
  });

// --- watch ---
program
  .command('watch')
  .description('Start real-time session monitoring with degradation detection')
  .option('-w, --window <minutes>', 'Rolling window size in minutes', '15')
  .option('-v, --verbose', 'Show detailed metrics on each update')
  .option('--db <path>', 'Custom database path')
  .action((opts) => {
    const config = loadConfig({ db: opts.db, window: parseInt(opts.window) });
    const watcher = new SessionWatcher({
      windowMinutes: config.metricsWindowMinutes,
      thresholds: config.qualityFloor,
    });

    console.log(chalk.bold('\n  AGENT SENTINEL — Real-Time Watcher\n'));
    console.log(chalk.gray(`  Window: ${config.metricsWindowMinutes} min | Polling: ${watcher['config'].pollIntervalMs / 1000}s`));
    console.log(chalk.gray('  Watching ~/.claude/projects/ for session activity...\n'));

    watcher.on('metrics', (metrics) => {
      if (opts.verbose) {
        const re = metrics.readEditRatio;
        const td = metrics.thinkingDepthScore;
        const be = metrics.editsWithoutPriorRead;
        const tc = metrics.toolCallSuccessRate;
        const reColor = re >= 4 ? chalk.green : re >= 2.5 ? chalk.yellow : chalk.red;
        const tdColor = td >= 1000 ? chalk.green : td >= 600 ? chalk.yellow : chalk.red;
        const beColor = be <= 10 ? chalk.green : be <= 33 ? chalk.yellow : chalk.red;
        const tcColor = tc >= 90 ? chalk.green : tc >= 80 ? chalk.yellow : chalk.red;

        process.stdout.write(
          `\r  R:E ${reColor(re.toFixed(1))} | Depth ${tdColor(Math.round(td).toString())} | Blind ${beColor(be.toFixed(0) + '%')} | ToolOK ${tcColor(tc.toFixed(0) + '%')} | Lazy ${metrics.lazyLanguageFrequency}  `
        );
      }
    });

    watcher.on('degradation', (event) => {
      console.log('');
      const icon = event.severity === 'critical' ? chalk.red('CRITICAL') : chalk.yellow('WARNING');
      console.log(`  ${icon} ${chalk.bold(event.failureMode)} detected`);
      console.log(chalk.gray(`    Recommended: ${event.recommendedLever}`));
      console.log(chalk.gray(`    R:E=${event.metrics.readEditRatio.toFixed(1)} Depth=${Math.round(event.metrics.thinkingDepthScore)} Blind=${event.metrics.editsWithoutPriorRead.toFixed(0)}%`));
      console.log('');

      // Persist event to database
      const db = new SentinelDB(opts.db);
      try {
        db.insertWatcherEvent({
          session_id: event.sessionId || 'unknown',
          severity: event.severity,
          failure_mode: event.failureMode,
          metrics_json: JSON.stringify(event.metrics),
          timestamp: event.timestamp.toISOString(),
        });
      } finally {
        db.close();
      }
    });

    watcher.on('error', (err) => {
      console.error(chalk.red(`  Error: ${err.message}`));
    });

    watcher.start();

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log(chalk.gray('\n\n  Watcher stopped.'));
      watcher.stop();
      process.exit(0);
    });
  });

// --- status ---
program
  .command('status')
  .description('Show current session quality metrics and degradation state')
  .option('--session <id>', 'Session ID to inspect')
  .option('--db <path>', 'Custom database path')
  .action((opts) => {
    const db = new SentinelDB(opts.db);
    try {
      // Show latest metrics from daily_metrics
      const detector = new RegressionDetector(db);
      const health = detector.getHealthStatus();

      const icon = health.status === 'green' ? chalk.green('HEALTHY') : health.status === 'yellow' ? chalk.yellow('WARNING') : chalk.red('DEGRADED');
      console.log(chalk.bold(`\n  SENTINEL STATUS — ${icon}\n`));

      // Key metrics
      const metrics = [
        { key: 'read_edit_ratio', label: 'Read:Edit Ratio', higherBetter: true },
        { key: 'thinking_depth_median', label: 'Thinking Depth', higherBetter: true },
        { key: 'blind_edit_rate', label: 'Blind Edit Rate', higherBetter: false },
        { key: 'laziness_total', label: 'Laziness Violations', higherBetter: false },
        { key: 'bash_success_rate', label: 'Tool Success Rate', higherBetter: true },
        { key: 'session_autonomy_median', label: 'Autonomy (min)', higherBetter: true },
        { key: 'frustration_rate', label: 'Frustration Rate', higherBetter: false },
        { key: 'sentiment_ratio', label: 'Sentiment Ratio', higherBetter: true },
      ];

      for (const m of metrics) {
        const latest = db.getLatestMetric(m.key);
        if (!latest) continue;
        const val = latest.value;
        const valStr = m.key.includes('rate') || m.key.includes('pct') ? `${val.toFixed(1)}%` : val.toFixed(2);
        console.log(`  ${m.label.padEnd(22)} ${chalk.white(valStr.padStart(8))}  ${chalk.gray(latest.date)}`);
      }

      // Alerts
      if (health.alerts.length > 0) {
        console.log(chalk.bold('\n  ALERTS\n'));
        for (const alert of health.alerts) {
          const colorFn = alert.severity === 'critical' ? chalk.red : chalk.yellow;
          console.log(`  ${colorFn(alert.message)}`);
        }
      }

      // Recent watcher events
      const events = db.getRecentWatcherEvents(5);
      if (events.length > 0) {
        console.log(chalk.bold('\n  RECENT DEGRADATION EVENTS\n'));
        for (const evt of events) {
          const sevColor = evt.severity === 'critical' ? chalk.red : chalk.yellow;
          console.log(`  ${sevColor(`[${evt.severity}]`)} ${evt.failure_mode} ${chalk.gray(evt.timestamp)}`);
        }
      }

      // Agent history
      if (opts.session) {
        const history = db.getAgentHistory(opts.session);
        if (history.length > 0) {
          console.log(chalk.bold('\n  AGENT HISTORY\n'));
          for (const run of history) {
            const score = run.quality_score >= 0.8 ? chalk.green(run.quality_score.toFixed(2)) :
                          run.quality_score >= 0.5 ? chalk.yellow(run.quality_score.toFixed(2)) :
                          chalk.red(run.quality_score.toFixed(2));
            console.log(`  ${run.agent_type}/${run.model_version || '?'} ${score} ${chalk.gray(run.start_time)}${run.handoff_reason ? ` -> ${run.handoff_reason}` : ''}`);
          }
        }
      }

      console.log('');
    } finally {
      db.close();
    }
  });

// --- context ---
const contextCmd = program
  .command('context')
  .description('Manage the context bus for cross-agent handoffs');

contextCmd
  .command('show')
  .description('Display current context bus state for a session')
  .argument('<session-id>', 'Session ID to inspect')
  .option('--db <path>', 'Custom database path')
  .action((sessionId, opts) => {
    const db = new SentinelDB(opts.db);
    try {
      const bus = new ContextBus(db, sessionId, '');

      // Task state
      const task = bus.getTaskState();
      if (task) {
        console.log(chalk.bold('\n  TASK STATE\n'));
        console.log(`  ${chalk.white(task.taskDescription)}`);
        console.log(chalk.gray(`  Started: ${task.startedAt.toISOString()} | Last activity: ${task.lastActivity.toISOString()}`));
        if (task.completedSteps.length > 0) {
          console.log(chalk.green('\n  Completed:'));
          task.completedSteps.forEach(s => console.log(`    ${chalk.green('+')} ${s}`));
        }
        if (task.remainingSteps.length > 0) {
          console.log(chalk.yellow('\n  Remaining:'));
          task.remainingSteps.forEach(s => console.log(`    ${chalk.yellow('-')} ${s}`));
        }
        if (task.blockers.length > 0) {
          console.log(chalk.red('\n  Blockers:'));
          task.blockers.forEach(b => console.log(`    ${chalk.red('!')} ${b}`));
        }
      } else {
        console.log(chalk.gray('\n  No task state recorded for this session.'));
      }

      // File operations
      const fileOps = bus.getFileOperations(20);
      if (fileOps.length > 0) {
        console.log(chalk.bold('\n  RECENT FILE OPERATIONS\n'));
        for (const op of fileOps) {
          const opColor = op.operation === 'read' ? chalk.blue : op.operation === 'edit' ? chalk.yellow : chalk.green;
          console.log(`  ${opColor(op.operation.toUpperCase().padEnd(6))} ${op.filePath} ${chalk.gray(`— ${op.reason}`)}`);
        }
      }

      // Decisions
      const decisions = bus.getDecisions(10);
      if (decisions.length > 0) {
        console.log(chalk.bold('\n  DECISIONS\n'));
        for (const d of decisions) {
          console.log(`  ${chalk.white(d.description)}`);
          console.log(`  ${chalk.gray(d.rationale)}`);
          console.log('');
        }
      }

      // Agent history
      const history = bus.getAgentHistory();
      if (history.length > 0) {
        console.log(chalk.bold('\n  AGENT HISTORY\n'));
        for (const run of history) {
          const score = run.qualityScore >= 0.8 ? chalk.green(run.qualityScore.toFixed(2)) :
                        run.qualityScore >= 0.5 ? chalk.yellow(run.qualityScore.toFixed(2)) :
                        chalk.red(run.qualityScore.toFixed(2));
          console.log(`  ${run.agentType}/${run.modelVersion} score=${score}${run.handoffReason ? ` handoff=${run.handoffReason}` : ''}`);
        }
      }

      console.log('');
    } finally {
      db.close();
    }
  });

contextCmd
  .command('handoff')
  .description('Generate a handoff prompt for agent switching')
  .argument('<session-id>', 'Session ID to generate handoff for')
  .option('--db <path>', 'Custom database path')
  .action((sessionId, opts) => {
    const db = new SentinelDB(opts.db);
    try {
      const bus = new ContextBus(db, sessionId, '');
      const prompt = bus.generateHandoffPrompt();

      if (prompt.length <= 25) {
        console.log(chalk.gray('No context data for this session. Start the watcher first.'));
        return;
      }

      console.log(chalk.bold('\n  HANDOFF PROMPT\n'));
      console.log(prompt);
      console.log('');
    } finally {
      db.close();
    }
  });

contextCmd
  .command('clear')
  .description('Reset context bus state for a session')
  .argument('<session-id>', 'Session ID to clear')
  .option('--db <path>', 'Custom database path')
  .action((sessionId, opts) => {
    const db = new SentinelDB(opts.db);
    try {
      const bus = new ContextBus(db, sessionId, '');
      bus.clear();
      console.log(chalk.green(`Context bus cleared for session ${sessionId}`));
    } finally {
      db.close();
    }
  });

program.parse();
