// ---------------------------------------------------------------------------
// Context Bus — shared state store for cross-agent handoffs
// ---------------------------------------------------------------------------

import { SentinelDB } from '../db/database';
import { FileOperation, ToolCallResult, Decision, TaskState, AgentRun, ContextBusState } from './types';
import { generateHandoffPrompt } from './handoff';
import crypto from 'crypto';

export class ContextBus {
  private db: SentinelDB;
  private sessionId: string;
  private projectPath: string;

  constructor(db: SentinelDB, sessionId: string, projectPath: string) {
    this.db = db;
    this.sessionId = sessionId;
    this.projectPath = projectPath;
  }

  // --- Write operations ---

  recordFileOperation(op: Omit<FileOperation, 'sessionId'>): void {
    this.db.insertFileOperation({
      session_id: this.sessionId,
      project_path: op.projectPath || this.projectPath,
      file_path: op.filePath,
      operation: op.operation,
      timestamp: op.timestamp.toISOString(),
      agent_id: op.agentId,
      reason: op.reason,
      before_hash: op.beforeHash,
      after_hash: op.afterHash,
    });
  }

  recordToolCall(tc: Omit<ToolCallResult, 'sessionId' | 'inputHash'>): void {
    const inputHash = crypto
      .createHash('sha256')
      .update(tc.toolName + JSON.stringify(tc.input))
      .digest('hex')
      .slice(0, 16);

    this.db.insertToolCacheEntry({
      session_id: this.sessionId,
      tool_name: tc.toolName,
      input_json: JSON.stringify(tc.input),
      output_json: JSON.stringify(tc.output),
      timestamp: tc.timestamp.toISOString(),
      ttl_seconds: tc.ttlSeconds,
      input_hash: inputHash,
    });
  }

  recordDecision(d: Omit<Decision, 'sessionId'>): void {
    this.db.insertDecision({
      session_id: this.sessionId,
      description: d.description,
      rationale: d.rationale,
      timestamp: d.timestamp.toISOString(),
      agent_id: d.agentId,
      reversible: d.reversible,
    });
  }

  updateTaskState(state: Partial<TaskState>): void {
    this.db.upsertTaskState({
      session_id: this.sessionId,
      project_path: state.projectPath || this.projectPath,
      task_description: state.taskDescription,
      started_at: state.startedAt?.toISOString(),
      last_activity: (state.lastActivity || new Date()).toISOString(),
      completed_steps: state.completedSteps ? JSON.stringify(state.completedSteps) : undefined,
      remaining_steps: state.remainingSteps ? JSON.stringify(state.remainingSteps) : undefined,
      blockers: state.blockers ? JSON.stringify(state.blockers) : undefined,
    });
  }

  recordAgentRun(run: Omit<AgentRun, 'sessionId'>): void {
    this.db.insertAgentRun({
      session_id: this.sessionId,
      agent_type: run.agentType,
      model_version: run.modelVersion,
      start_time: run.startTime.toISOString(),
      end_time: run.endTime?.toISOString(),
      quality_score: run.qualityScore,
      handoff_reason: run.handoffReason,
      lever: run.lever,
    });
  }

  // --- Read operations ---

  getFileOperations(limit: number = 200): FileOperation[] {
    return this.db.getRecentFileOperations(this.sessionId, limit).map(row => ({
      id: row.id,
      sessionId: row.session_id,
      projectPath: row.project_path,
      filePath: row.file_path,
      operation: row.operation as FileOperation['operation'],
      timestamp: new Date(row.timestamp),
      agentId: row.agent_id,
      reason: row.reason || '',
      beforeHash: row.before_hash,
      afterHash: row.after_hash,
    }));
  }

  getCachedToolResult(toolName: string, input: Record<string, unknown>): unknown | null {
    const inputHash = crypto
      .createHash('sha256')
      .update(toolName + JSON.stringify(input))
      .digest('hex')
      .slice(0, 16);

    return this.db.lookupToolCache(this.sessionId, inputHash);
  }

  getDecisions(limit: number = 50): Decision[] {
    return this.db.getRecentDecisions(this.sessionId, limit).map(row => ({
      id: row.id,
      sessionId: row.session_id,
      description: row.description,
      rationale: row.rationale,
      timestamp: new Date(row.timestamp),
      agentId: row.agent_id,
      reversible: !!row.reversible,
    }));
  }

  getTaskState(): TaskState | null {
    const row = this.db.getTaskState(this.sessionId);
    if (!row) return null;
    return {
      id: row.id,
      sessionId: row.session_id,
      projectPath: row.project_path,
      taskDescription: row.task_description || '',
      startedAt: new Date(row.started_at),
      lastActivity: new Date(row.last_activity),
      completedSteps: JSON.parse(row.completed_steps || '[]'),
      remainingSteps: JSON.parse(row.remaining_steps || '[]'),
      blockers: JSON.parse(row.blockers || '[]'),
    };
  }

  getAgentHistory(): AgentRun[] {
    return this.db.getAgentHistory(this.sessionId).map(row => ({
      id: row.id,
      sessionId: row.session_id,
      agentType: row.agent_type,
      modelVersion: row.model_version || '',
      startTime: new Date(row.start_time),
      endTime: row.end_time ? new Date(row.end_time) : undefined,
      qualityScore: row.quality_score,
      handoffReason: row.handoff_reason,
      lever: row.lever as AgentRun['lever'],
    }));
  }

  // --- Handoff ---

  getState(): ContextBusState {
    return {
      sessionId: this.sessionId,
      projectPath: this.projectPath,
      taskState: this.getTaskState(),
      fileOperations: this.getFileOperations(),
      toolCallCache: [], // Simplified — full cache is in DB
      decisions: this.getDecisions(),
      agentHistory: this.getAgentHistory(),
    };
  }

  generateHandoffPrompt(): string {
    return generateHandoffPrompt(this.getState());
  }

  // --- Cleanup ---

  clear(): void {
    this.db.clearContextBus(this.sessionId);
  }
}
