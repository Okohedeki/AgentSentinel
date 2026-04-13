// ---------------------------------------------------------------------------
// Default configuration values — matching idea.md spec
// ---------------------------------------------------------------------------

import { SentinelConfig } from './types';
import { DEFAULT_THRESHOLDS } from '../watcher/types';

export const DEFAULT_CONFIG: SentinelConfig = {
  qualityFloor: DEFAULT_THRESHOLDS,
  metricsWindowMinutes: 15,

  agents: [
    {
      type: 'claude-code',
      model: 'claude-opus-4-6',
      bin: 'claude',
      args: [],
      contextStrategy: 'handoff-prompt',
    },
  ],

  contextBus: {
    toolCallCacheTtlSeconds: 300,
    maxDecisions: 50,
    maxFileOperations: 200,
  },

  leverMapping: {
    'lazy-shortcuts': ['harden-harness', 'harden-prompt', 'switch-model'],
    'reasoning-loops': ['harden-prompt', 'switch-model'],
    'tool-failure': ['switch-model', 'harden-harness'],
    'context-loss': ['switch-model'],
    'output-drift': ['eval-loop', 'harden-prompt'],
  },

  leverRetryLimit: 2,
  switchCooldownMinutes: 10,
  evalsDir: '.sentinel/evals',

  database: {},

  notifications: {
    onSwitch: true,
    onPromptHarden: false,
    onHarnessHarden: false,
    onEvalLoop: true,
  },
};
