// ---------------------------------------------------------------------------
// Context Bus Populator — bridges Watcher events into Context Bus records
// ---------------------------------------------------------------------------

import { ContextBus } from './context-bus';
import { ParsedAssistantMessage, ParsedUserMessage, ParsedToolCall } from '../scanner/log-parser';

/**
 * Extracts structured context from parsed session messages and writes
 * them to the Context Bus. This is the bridge between the Watcher
 * (which parses raw JSONL) and the Context Bus (which stores state).
 */
export class ContextBusPopulator {
  private bus: ContextBus;
  private agentId: string;

  constructor(bus: ContextBus, agentId: string = 'claude-code') {
    this.bus = bus;
    this.agentId = agentId;
  }

  /** Process a parsed assistant message into context bus records */
  processAssistantMessage(msg: ParsedAssistantMessage, sessionId: string): void {
    const timestamp = msg.timestamp ? new Date(msg.timestamp) : new Date();

    // Extract file operations from tool calls
    for (const tc of msg.toolCalls) {
      this.processToolCall(tc, timestamp, sessionId);
    }
  }

  /** Process a parsed user message (primarily for tool results) */
  processUserMessage(msg: ParsedUserMessage): void {
    // Tool results can indicate completed operations
    for (const tr of msg.toolResults) {
      if (!tr.isError) {
        this.bus.recordToolCall({
          toolName: 'tool_result',
          input: { tool_use_id: tr.toolUseId },
          output: tr.content.slice(0, 1000), // Cap output size
          timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
          ttlSeconds: 300,
        });
      }
    }
  }

  private processToolCall(tc: ParsedToolCall, timestamp: Date, sessionId: string): void {
    // Track file operations
    if (tc.targetFile) {
      const operationMap: Record<string, 'read' | 'edit' | 'create' | 'delete'> = {
        read: 'read',
        edit: 'edit',
        write: 'create',
        search: 'read',
      };
      const operation = operationMap[tc.category] || 'read';

      this.bus.recordFileOperation({
        projectPath: '',
        filePath: tc.targetFile,
        operation,
        timestamp,
        agentId: this.agentId,
        reason: `${tc.toolName} call`,
      });
    }

    // Cache tool call results (input side — output comes from tool results)
    if (tc.category === 'search' || tc.category === 'read') {
      this.bus.recordToolCall({
        toolName: tc.toolName,
        input: tc.input,
        output: null, // Output comes from tool result
        timestamp,
        ttlSeconds: 300,
      });
    }
  }
}
