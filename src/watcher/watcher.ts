// ---------------------------------------------------------------------------
// SessionWatcher — real-time JSONL file watching with degradation detection
// ---------------------------------------------------------------------------

import chokidar from 'chokidar';
import EventEmitter from 'eventemitter3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { discoverSessionLogs, RawLogEntry, parseAssistantMessage, parseUserMessage } from '../scanner/log-parser';
import { RollingWindow } from './metrics-window';
import { classifyFailureMode, buildDegradationEvent } from './failure-classifier';
import { WatcherConfig, DEFAULT_WATCHER_CONFIG, SessionMetrics, DegradationEvent } from './types';
import { SentinelDB } from '../db/database';
import { ContextBus } from '../context-bus/context-bus';
import { ContextBusPopulator } from '../context-bus/populator';

interface WatcherEvents {
  degradation: (event: DegradationEvent) => void;
  metrics: (metrics: SessionMetrics) => void;
  error: (error: Error) => void;
}

export class SessionWatcher extends EventEmitter<WatcherEvents> {
  private config: WatcherConfig;
  private fsWatcher: chokidar.FSWatcher | null = null;
  private fileOffsets: Map<string, number> = new Map();
  private window: RollingWindow;
  private metricsInterval: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastMetrics: SessionMetrics | null = null;

  // Context bus integration
  private db: SentinelDB | null = null;
  private populators: Map<string, ContextBusPopulator> = new Map();

  constructor(config: Partial<WatcherConfig> = {}) {
    super();
    this.config = { ...DEFAULT_WATCHER_CONFIG, ...config };
    this.window = new RollingWindow(this.config.windowMinutes);
  }

  /**
   * Attach a database for context bus population.
   * When set, the watcher writes file operations, tool calls, and decisions
   * to the context bus tables in real time — enabling `sentinel context show`
   * and `sentinel context handoff` to return live data.
   */
  attachDatabase(db: SentinelDB): void {
    this.db = db;
  }

  /** Start watching session log files for changes */
  start(): void {
    if (this.running) return;
    this.running = true;

    const watchDirs = this.getWatchDirectories();
    if (watchDirs.length === 0) {
      this.emit('error', new Error('No Claude session log directories found'));
      return;
    }

    this.fsWatcher = chokidar.watch(watchDirs, {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
      depth: 5,
    });

    this.fsWatcher
      .on('add', (filePath) => this.handleFileChange(filePath))
      .on('change', (filePath) => this.handleFileChange(filePath))
      .on('error', (err) => this.emit('error', err));

    // Periodic metrics recomputation
    this.metricsInterval = setInterval(() => {
      this.recomputeAndEmit();
    }, this.config.pollIntervalMs);
  }

  /** Stop watching and close database if owned */
  stop(): void {
    this.running = false;
    if (this.fsWatcher) {
      this.fsWatcher.close();
      this.fsWatcher = null;
    }
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
  }

  /** Get the latest computed metrics */
  getMetrics(): SessionMetrics | null {
    return this.lastMetrics;
  }

  /** Check if watcher is currently running */
  isRunning(): boolean {
    return this.running;
  }

  private getWatchDirectories(): string[] {
    if (this.config.watchPaths && this.config.watchPaths.length > 0) {
      return this.config.watchPaths;
    }

    const homeDir = os.homedir();
    const claudeProjectsDir = path.join(homeDir, '.claude', 'projects');
    const dirs: string[] = [];
    if (fs.existsSync(claudeProjectsDir)) {
      dirs.push(claudeProjectsDir);
    }
    return dirs;
  }

  /** Get or create a ContextBusPopulator for a given session */
  private getPopulator(sessionId: string, filePath: string): ContextBusPopulator | null {
    if (!this.db) return null;
    if (!sessionId) return null;

    let populator = this.populators.get(sessionId);
    if (!populator) {
      const projectPath = this.extractProjectPath(filePath);
      const bus = new ContextBus(this.db, sessionId, projectPath);
      populator = new ContextBusPopulator(bus);
      this.populators.set(sessionId, populator);

      // Record this agent run
      bus.recordAgentRun({
        agentType: 'claude-code',
        modelVersion: '',
        startTime: new Date(),
        qualityScore: 1.0,
      });
    }
    return populator;
  }

  private extractProjectPath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    const parts = normalized.split('/');
    const projIdx = parts.indexOf('projects');
    if (projIdx >= 0 && projIdx + 1 < parts.length) {
      return parts[projIdx + 1];
    }
    return 'unknown';
  }

  private handleFileChange(filePath: string): void {
    if (!filePath.endsWith('.jsonl')) return;

    try {
      const newEntries = this.readNewLines(filePath);
      if (newEntries.length === 0) return;

      for (const entry of newEntries) {
        this.processEntry(entry, filePath);
      }
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  /** Read only new lines appended since last read */
  private readNewLines(filePath: string): RawLogEntry[] {
    const currentOffset = this.fileOffsets.get(filePath) || 0;

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return [];
    }

    if (stat.size <= currentOffset) return [];

    const fd = fs.openSync(filePath, 'r');
    try {
      const bufferSize = stat.size - currentOffset;
      const buffer = Buffer.alloc(bufferSize);
      fs.readSync(fd, buffer, 0, bufferSize, currentOffset);
      this.fileOffsets.set(filePath, stat.size);

      const text = buffer.toString('utf-8');
      const lines = text.split('\n');
      const entries: RawLogEntry[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          entries.push(JSON.parse(trimmed) as RawLogEntry);
        } catch {
          // Skip malformed lines
        }
      }

      return entries;
    } finally {
      fs.closeSync(fd);
    }
  }

  /** Process a single JSONL entry into metrics window AND context bus */
  private processEntry(entry: RawLogEntry, filePath: string): void {
    const timestamp = entry.timestamp ? new Date(entry.timestamp) : new Date();
    const sessionId = entry.sessionId || '';
    const populator = this.getPopulator(sessionId, filePath);

    switch (entry.type) {
      case 'assistant': {
        const parsed = parseAssistantMessage(entry);
        if (parsed.model) this.window.setModel(parsed.model);

        // Feed metrics window
        for (const tc of parsed.toolCalls) {
          this.window.addToolCall(tc, timestamp, sessionId);
        }
        for (const tb of parsed.thinkingBlocks) {
          this.window.addThinkingBlock(tb, timestamp);
        }
        for (const rl of parsed.reasoningLoops) {
          this.window.addReasoningLoop(timestamp, rl.phrase);
        }
        for (const lv of parsed.lazinessViolations) {
          this.window.addLazinessViolation(timestamp, lv.category, lv.phrase);
        }

        // Feed context bus
        if (populator) {
          populator.processAssistantMessage(parsed, sessionId);
        }
        break;
      }

      case 'user': {
        const parsed = parseUserMessage(entry);
        if (parsed.isHumanPrompt) {
          this.window.addUserPrompt(timestamp, parsed.isInterrupt, true);
        }
        for (const tr of parsed.toolResults) {
          this.window.addToolResult(timestamp, tr.toolUseId, tr.isError);
        }

        // Feed context bus
        if (populator) {
          populator.processUserMessage(parsed);
        }
        break;
      }
    }
  }

  /** Recompute metrics and check for degradation */
  private recomputeAndEmit(): void {
    if (!this.window.hasData()) return;

    const metrics = this.window.computeMetrics();
    this.lastMetrics = metrics;
    this.emit('metrics', metrics);

    const classification = classifyFailureMode(metrics, this.config.thresholds);
    if (classification) {
      const event = buildDegradationEvent(classification, metrics);
      this.emit('degradation', event);
    }
  }
}
