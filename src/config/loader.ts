// ---------------------------------------------------------------------------
// Configuration loader — CLI flags + defaults for MVP
// ---------------------------------------------------------------------------

import { SentinelConfig } from './types';
import { DEFAULT_CONFIG } from './defaults';
import { QualityThresholds } from '../watcher/types';

interface CLIOverrides {
  db?: string;
  window?: number;
  thresholdReadEditRatio?: number;
  thresholdThinkingDepth?: number;
  thresholdBlindEditRate?: number;
  thresholdToolSuccess?: number;
}

/**
 * Load configuration merging CLI overrides with defaults.
 * Config file loading (sentinel.config.ts) deferred to post-MVP.
 */
export function loadConfig(overrides: CLIOverrides = {}): SentinelConfig {
  const config = { ...DEFAULT_CONFIG };

  // Apply CLI overrides
  if (overrides.db) {
    config.database = { path: overrides.db };
  }

  if (overrides.window) {
    config.metricsWindowMinutes = overrides.window;
  }

  // Threshold overrides
  const thresholds: Partial<QualityThresholds> = {};
  if (overrides.thresholdReadEditRatio !== undefined) thresholds.readEditRatio = overrides.thresholdReadEditRatio;
  if (overrides.thresholdThinkingDepth !== undefined) thresholds.thinkingDepthScore = overrides.thresholdThinkingDepth;
  if (overrides.thresholdBlindEditRate !== undefined) thresholds.blindEditRate = overrides.thresholdBlindEditRate;
  if (overrides.thresholdToolSuccess !== undefined) thresholds.toolCallSuccessRate = overrides.thresholdToolSuccess;

  if (Object.keys(thresholds).length > 0) {
    config.qualityFloor = { ...config.qualityFloor, ...thresholds };
  }

  return config;
}
