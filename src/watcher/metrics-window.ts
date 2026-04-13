// ---------------------------------------------------------------------------
// Rolling window for real-time metric computation
// ---------------------------------------------------------------------------

import { ParsedToolCall, ParsedThinkingBlock, TextPatternMatch, LazinessCategory } from '../scanner/log-parser';
import { SessionMetrics } from './types';

/** Signature-to-content ratio for estimating redacted thinking depth */
const SIGNATURE_TO_CONTENT_RATIO = 4.26;
const MAX_ENTRIES = 5000;

interface TimestampedToolCall extends ParsedToolCall {
  timestamp: Date;
  sessionId: string;
}

interface TimestampedThinkingBlock extends ParsedThinkingBlock {
  timestamp: Date;
}

interface TimestampedUserPrompt {
  timestamp: Date;
  isInterrupt: boolean;
  isHumanPrompt: boolean;
}

interface TimestampedLaziness {
  timestamp: Date;
  category: LazinessCategory;
  phrase: string;
}

interface TimestampedReasoningLoop {
  timestamp: Date;
  phrase: string;
}

interface TimestampedToolResult {
  timestamp: Date;
  toolUseId: string;
  isError: boolean;
}

export class RollingWindow {
  private toolCalls: TimestampedToolCall[] = [];
  private thinkingBlocks: TimestampedThinkingBlock[] = [];
  private userPrompts: TimestampedUserPrompt[] = [];
  private lazinessViolations: TimestampedLaziness[] = [];
  private reasoningLoops: TimestampedReasoningLoop[] = [];
  private toolResults: TimestampedToolResult[] = [];

  private windowMinutes: number;
  private lastSessionId: string = '';
  private lastModel: string = '';

  constructor(windowMinutes: number = 15) {
    this.windowMinutes = windowMinutes;
  }

  addToolCall(tc: ParsedToolCall, timestamp: Date, sessionId: string): void {
    this.toolCalls.push({ ...tc, timestamp, sessionId });
    this.lastSessionId = sessionId;
    this.enforceLimit(this.toolCalls);
  }

  addThinkingBlock(tb: ParsedThinkingBlock, timestamp: Date): void {
    this.thinkingBlocks.push({ ...tb, timestamp });
    this.enforceLimit(this.thinkingBlocks);
  }

  addUserPrompt(timestamp: Date, isInterrupt: boolean, isHumanPrompt: boolean): void {
    this.userPrompts.push({ timestamp, isInterrupt, isHumanPrompt });
    this.enforceLimit(this.userPrompts);
  }

  addLazinessViolation(timestamp: Date, category: LazinessCategory, phrase: string): void {
    this.lazinessViolations.push({ timestamp, category, phrase });
    this.enforceLimit(this.lazinessViolations);
  }

  addReasoningLoop(timestamp: Date, phrase: string): void {
    this.reasoningLoops.push({ timestamp, phrase });
    this.enforceLimit(this.reasoningLoops);
  }

  addToolResult(timestamp: Date, toolUseId: string, isError: boolean): void {
    this.toolResults.push({ timestamp, toolUseId, isError });
    this.enforceLimit(this.toolResults);
  }

  setModel(model: string): void {
    this.lastModel = model;
  }

  /** Evict entries older than the rolling window */
  evict(): void {
    const cutoff = new Date(Date.now() - this.windowMinutes * 60 * 1000);
    this.toolCalls = this.toolCalls.filter(e => e.timestamp >= cutoff);
    this.thinkingBlocks = this.thinkingBlocks.filter(e => e.timestamp >= cutoff);
    this.userPrompts = this.userPrompts.filter(e => e.timestamp >= cutoff);
    this.lazinessViolations = this.lazinessViolations.filter(e => e.timestamp >= cutoff);
    this.reasoningLoops = this.reasoningLoops.filter(e => e.timestamp >= cutoff);
    this.toolResults = this.toolResults.filter(e => e.timestamp >= cutoff);
  }

  /** Compute all metrics from the current window contents */
  computeMetrics(): SessionMetrics {
    this.evict();

    const totalToolCalls = this.toolCalls.length;
    const reads = this.toolCalls.filter(tc => tc.category === 'read').length;
    const edits = this.toolCalls.filter(tc => tc.category === 'edit').length;
    const writes = this.toolCalls.filter(tc => tc.category === 'write').length;
    const mutations = edits + writes;

    // Read:edit ratio
    const readEditRatio = mutations > 0 ? reads / mutations : reads > 0 ? reads : 0;

    // Thinking depth — median estimated depth
    const thinkingDepthScore = this.computeMedianThinkingDepth();

    // Blind edit rate — % of edits without a recent read of the same file
    const editsWithoutPriorRead = this.computeBlindEditRate();

    // Autonomous run minutes — median gap between human prompts
    const autonomousRunMinutes = this.computeAutonomousRunMinutes();

    // User interrupt rate — interrupts per hour
    const windowHours = this.windowMinutes / 60;
    const interrupts = this.userPrompts.filter(p => p.isInterrupt).length;
    const userInterruptRate = windowHours > 0 ? interrupts / windowHours : 0;

    // Laziness
    const lazyLanguageFrequency = this.lazinessViolations.length;

    // Reasoning loops per 1k tool calls
    const reasoningLoopCount = totalToolCalls > 0
      ? (this.reasoningLoops.length / totalToolCalls) * 1000
      : 0;

    // Tool call success rate
    const toolCallSuccessRate = this.computeToolCallSuccessRate();

    return {
      readEditRatio,
      thinkingDepthScore,
      autonomousRunMinutes,
      userInterruptRate,
      editsWithoutPriorRead,
      lazyLanguageFrequency,
      reasoningLoopCount,
      toolCallSuccessRate,
      sessionId: this.lastSessionId,
      agentType: 'claude-code',
      modelVersion: this.lastModel,
      timestamp: new Date(),
      windowMinutes: this.windowMinutes,
    };
  }

  /** Check if the window has enough data to produce meaningful metrics */
  hasData(): boolean {
    return this.toolCalls.length > 0;
  }

  private computeMedianThinkingDepth(): number {
    if (this.thinkingBlocks.length === 0) return 0;

    const depths = this.thinkingBlocks.map(tb => {
      if (tb.isRedacted) {
        return tb.signatureLength * SIGNATURE_TO_CONTENT_RATIO;
      }
      return tb.contentLength;
    });

    depths.sort((a, b) => a - b);
    const mid = Math.floor(depths.length / 2);
    return depths.length % 2 !== 0
      ? depths[mid]
      : (depths[mid - 1] + depths[mid]) / 2;
  }

  private computeBlindEditRate(): number {
    const editCalls = this.toolCalls.filter(tc => tc.category === 'edit' || tc.category === 'write');
    if (editCalls.length === 0) return 0;

    let blindEdits = 0;
    for (const edit of editCalls) {
      if (!edit.targetFile) continue;
      // Look back up to 10 tool calls before this edit
      const editIdx = this.toolCalls.indexOf(edit);
      const lookbackStart = Math.max(0, editIdx - 10);
      const precedingCalls = this.toolCalls.slice(lookbackStart, editIdx);
      const wasRead = precedingCalls.some(
        tc => tc.category === 'read' && tc.targetFile === edit.targetFile
      );
      if (!wasRead) blindEdits++;
    }

    return (blindEdits / editCalls.length) * 100;
  }

  private computeAutonomousRunMinutes(): number {
    const humanPrompts = this.userPrompts
      .filter(p => p.isHumanPrompt)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    if (humanPrompts.length < 2) {
      // If only one prompt, measure from it to now
      if (humanPrompts.length === 1) {
        return (Date.now() - humanPrompts[0].timestamp.getTime()) / 60000;
      }
      return this.windowMinutes; // No prompts = fully autonomous
    }

    // Compute median gap between consecutive human prompts
    const gaps: number[] = [];
    for (let i = 1; i < humanPrompts.length; i++) {
      const gapMs = humanPrompts[i].timestamp.getTime() - humanPrompts[i - 1].timestamp.getTime();
      gaps.push(gapMs / 60000);
    }

    gaps.sort((a, b) => a - b);
    const mid = Math.floor(gaps.length / 2);
    return gaps.length % 2 !== 0
      ? gaps[mid]
      : (gaps[mid - 1] + gaps[mid]) / 2;
  }

  private computeToolCallSuccessRate(): number {
    if (this.toolResults.length === 0) return 100;
    const errors = this.toolResults.filter(tr => tr.isError).length;
    return ((this.toolResults.length - errors) / this.toolResults.length) * 100;
  }

  private enforceLimit(arr: any[]): void {
    if (arr.length > MAX_ENTRIES) {
      arr.splice(0, arr.length - MAX_ENTRIES);
    }
  }
}
