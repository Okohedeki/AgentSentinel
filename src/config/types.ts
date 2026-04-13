// ---------------------------------------------------------------------------
// Sentinel configuration types
// ---------------------------------------------------------------------------

import { QualityThresholds } from '../watcher/types';

export interface AgentConfig {
  type: 'claude-code' | 'codex' | 'gemini' | 'cursor';
  model: string;
  bin: string;
  args: string[];
  contextStrategy: 'handoff-prompt' | 'worktree' | 'shared-memory';
}

export interface ContextBusConfig {
  toolCallCacheTtlSeconds: number;
  maxDecisions: number;
  maxFileOperations: number;
}

export interface SentinelConfig {
  qualityFloor: QualityThresholds;
  metricsWindowMinutes: number;
  agents: AgentConfig[];
  contextBus: ContextBusConfig;
  leverMapping: Record<string, string[]>;
  leverRetryLimit: number;
  switchCooldownMinutes: number;
  evalsDir: string;
  database: { path?: string };
  notifications: {
    onSwitch: boolean;
    onPromptHarden: boolean;
    onHarnessHarden: boolean;
    onEvalLoop: boolean;
  };
}
