// ---------------------------------------------------------------------------
// Failure mode classification — pure function, no side effects
// ---------------------------------------------------------------------------

import { SessionMetrics, QualityThresholds, FailureMode, Lever, DegradationEvent } from './types';

interface ClassificationResult {
  mode: FailureMode;
  severity: 'warning' | 'critical';
  lever: Lever;
}

/** Lever preference order per failure mode (from idea.md spec) */
const LEVER_MAP: Record<FailureMode, Lever[]> = {
  'lazy-shortcuts': ['harden-harness', 'harden-prompt', 'switch-model'],
  'reasoning-loops': ['harden-prompt', 'switch-model'],
  'tool-failure': ['switch-model', 'harden-harness'],
  'context-loss': ['switch-model'],
  'output-drift': ['eval-loop', 'harden-prompt'],
};

/**
 * Classify the failure mode from current metrics and thresholds.
 * Returns null if no degradation detected.
 */
export function classifyFailureMode(
  metrics: SessionMetrics,
  thresholds: QualityThresholds
): ClassificationResult | null {
  const signals: Array<{ mode: FailureMode; severity: 'warning' | 'critical'; score: number }> = [];

  // --- lazy-shortcuts ---
  // Low read:edit ratio + high blind edit rate + laziness present
  const reLow = metrics.readEditRatio < thresholds.readEditRatio;
  const blindHigh = metrics.editsWithoutPriorRead > thresholds.blindEditRate;
  const lazyHigh = metrics.lazyLanguageFrequency > thresholds.lazinessViolations;
  if (reLow || blindHigh || lazyHigh) {
    const count = [reLow, blindHigh, lazyHigh].filter(Boolean).length;
    signals.push({
      mode: 'lazy-shortcuts',
      severity: count >= 2 ? 'critical' : 'warning',
      score: count,
    });
  }

  // --- reasoning-loops ---
  // High loop count + low autonomous run time
  const loopsHigh = metrics.reasoningLoopCount > thresholds.reasoningLoopsPer1k;
  const autonomyLow = metrics.autonomousRunMinutes < thresholds.autonomousRunMinutes;
  if (loopsHigh || autonomyLow) {
    const count = [loopsHigh, autonomyLow].filter(Boolean).length;
    signals.push({
      mode: 'reasoning-loops',
      severity: count >= 2 ? 'critical' : 'warning',
      score: count,
    });
  }

  // --- tool-failure ---
  // Low tool call success rate
  if (metrics.toolCallSuccessRate < thresholds.toolCallSuccessRate) {
    const diff = thresholds.toolCallSuccessRate - metrics.toolCallSuccessRate;
    signals.push({
      mode: 'tool-failure',
      severity: diff > 30 ? 'critical' : 'warning',
      score: diff / 10,
    });
  }

  // --- context-loss ---
  // Thinking depth collapse signals context loss
  if (metrics.thinkingDepthScore < thresholds.thinkingDepthScore * 0.5) {
    signals.push({
      mode: 'context-loss',
      severity: 'critical',
      score: 3,
    });
  }

  // --- output-drift ---
  // Thinking depth below threshold but not at context-loss level
  if (
    metrics.thinkingDepthScore < thresholds.thinkingDepthScore &&
    metrics.thinkingDepthScore >= thresholds.thinkingDepthScore * 0.5
  ) {
    signals.push({
      mode: 'output-drift',
      severity: 'warning',
      score: 1,
    });
  }

  if (signals.length === 0) return null;

  // Return the highest-scoring failure mode
  signals.sort((a, b) => b.score - a.score || (a.severity === 'critical' ? -1 : 1));
  const top = signals[0];

  return {
    mode: top.mode,
    severity: top.severity,
    lever: LEVER_MAP[top.mode][0],
  };
}

/**
 * Build a full DegradationEvent from classification result and metrics.
 */
export function buildDegradationEvent(
  classification: ClassificationResult,
  metrics: SessionMetrics
): DegradationEvent {
  return {
    sessionId: metrics.sessionId,
    severity: classification.severity,
    failureMode: classification.mode,
    metrics,
    recommendedLever: classification.lever,
    timestamp: new Date(),
  };
}
