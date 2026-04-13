// ---------------------------------------------------------------------------
// Context Bus types — shared state for cross-agent handoffs
// ---------------------------------------------------------------------------

import { Lever } from '../watcher/types';

export interface FileOperation {
  id?: number;
  sessionId: string;
  projectPath: string;
  filePath: string;
  operation: 'read' | 'edit' | 'create' | 'delete';
  timestamp: Date;
  agentId: string;
  reason: string;
  beforeHash?: string;
  afterHash?: string;
}

export interface ToolCallResult {
  id?: number;
  sessionId: string;
  toolName: string;
  input: Record<string, unknown>;
  output: unknown;
  timestamp: Date;
  ttlSeconds: number;
  inputHash: string;
}

export interface Decision {
  id?: number;
  sessionId: string;
  description: string;
  rationale: string;
  timestamp: Date;
  agentId: string;
  reversible: boolean;
}

export interface TaskState {
  id?: number;
  sessionId: string;
  projectPath: string;
  taskDescription: string;
  startedAt: Date;
  lastActivity: Date;
  completedSteps: string[];
  remainingSteps: string[];
  blockers: string[];
}

export interface AgentRun {
  id?: number;
  sessionId: string;
  agentType: string;
  modelVersion: string;
  startTime: Date;
  endTime?: Date;
  qualityScore: number;
  handoffReason?: string;
  lever?: Lever;
}

export interface ContextBusState {
  sessionId: string;
  projectPath: string;
  taskState: TaskState | null;
  fileOperations: FileOperation[];
  toolCallCache: ToolCallResult[];
  decisions: Decision[];
  agentHistory: AgentRun[];
}
