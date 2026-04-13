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

  constructor(config: Partial<WatcherConfig> = {}) {
    super();
    this.config = { ...DEFAULT_WATCHER_CONFIG, ...config };
    this.window = new RollingWindow(this.config.windowMinutes);
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

  /** Stop watching */
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

    // Discover all project directories containing JSONL files
    const homeDir = os.homedir();
    const claudeProjectsDir = path.join(homeDir, '.claude', 'projects');
    const dirs: string[] = [];
    if (fs.existsSync(claudeProjectsDir)) {
      dirs.push(claudeProjectsDir);
    }
    return dirs;
  }

  private handleFileChange(filePath: string): void {
    if (!filePath.endsWith('.jsonl')) return;

    try {
      const newEntries = this.readNewLines(filePath);
      if (newEntries.length === 0) return;

      for (const entry of newEntries) {
        this.processEntry(entry);
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

  /** Process a single JSONL entry into the rolling window */
  private processEntry(entry: RawLogEntry): void {
    const timestamp = entry.timestamp ? new Date(entry.timestamp) : new Date();

    switch (entry.type) {
      case 'assistant': {
        const parsed = parseAssistantMessage(entry);
        if (parsed.model) this.window.setModel(parsed.model);

        for (const tc of parsed.toolCalls) {
          this.window.addToolCall(tc, timestamp, entry.sessionId || '');
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
        break;
      }

      case 'user': {
        const parsed = parseUserMessage(entry);
        if (parsed.isHumanPrompt) {
          this.window.addUserPrompt(timestamp, parsed.isInterrupt, true);
        }
        // Process tool results for success rate tracking
        for (const tr of parsed.toolResults) {
          this.window.addToolResult(timestamp, tr.toolUseId, tr.isError);
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
