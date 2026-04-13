// ---------------------------------------------------------------------------
// Watcher types — real-time session monitoring
// ---------------------------------------------------------------------------

export interface WatcherConfig {
  /** Directories to watch for JSONL files. Defaults to discoverSessionLogs() paths. */
  watchPaths?: string[];
  /** Rolling window size in minutes for metric computation. Default: 15 */
  windowMinutes: number;
  /** How often to recompute metrics (ms). Default: 10000 */
  pollIntervalMs: number;
  /** Degradation thresholds */
  thresholds: QualityThresholds;
}

export interface QualityThresholds {
  /** Read:edit ratio below this = degraded. Default: 2.5 */
  readEditRatio: number;
  /** Thinking depth (estimated chars) below this = degraded. Default: 600 */
  thinkingDepthScore: number;
  /** Blind edit rate above this % = degraded. Default: 33.7 */
  blindEditRate: number;
  /** Tool call success rate below this % = degraded. Default: 80 */
  toolCallSuccessRate: number;
  /** Laziness violations per window above this = degraded. Default: 5 */
  lazinessViolations: number;
  /** Reasoning loops per 1k tool calls above this = degraded. Default: 20 */
  reasoningLoopsPer1k: number;
  /** Autonomous run minutes below this = degraded. Default: 3 */
  autonomousRunMinutes: number;
}

export const DEFAULT_THRESHOLDS: QualityThresholds = {
  readEditRatio: 2.5,
  thinkingDepthScore: 600,
  blindEditRate: 33.7,
  toolCallSuccessRate: 80,
  lazinessViolations: 5,
  reasoningLoopsPer1k: 20,
  autonomousRunMinutes: 3,
};

export const DEFAULT_WATCHER_CONFIG: WatcherConfig = {
  windowMinutes: 15,
  pollIntervalMs: 10000,
  thresholds: DEFAULT_THRESHOLDS,
};

export interface SessionMetrics {
  /** Reads / edits — healthy: >4.0, degraded: <2.0 */
  readEditRatio: number;
  /** Proxy via thinking block estimated depth */
  thinkingDepthScore: number;
  /** Minutes between human interventions */
  autonomousRunMinutes: number;
  /** User interrupts per hour */
  userInterruptRate: number;
  /** % of edits where no read preceded them */
  editsWithoutPriorRead: number;
  /** Laziness pattern occurrences */
  lazyLanguageFrequency: number;
  /** Reasoning loop occurrences per 1k tool calls */
  reasoningLoopCount: number;
  /** Successful tool calls / total tool calls (%) */
  toolCallSuccessRate: number;
  /** Session identifier */
  sessionId: string;
  /** Agent type */
  agentType: 'claude-code' | 'codex' | 'gemini' | 'cursor';
  /** Model version string */
  modelVersion: string;
  /** When these metrics were computed */
  timestamp: Date;
  /** Rolling window size used */
  windowMinutes: number;
}

export type FailureMode =
  | 'lazy-shortcuts'    // low read:edit, lazy language, edits without reads
  | 'reasoning-loops'   // high loop count, low autonomous run time
  | 'tool-failure'      // low tool call success rate
  | 'context-loss'      // inconsistent behavior on same files
  | 'output-drift';     // behavioral change vs baseline

export type Lever = 'switch-model' | 'harden-prompt' | 'harden-harness' | 'eval-loop';

export interface DegradationEvent {
  sessionId: string;
  severity: 'warning' | 'critical';
  failureMode: FailureMode;
  metrics: SessionMetrics;
  recommendedLever: Lever;
  timestamp: Date;
}
