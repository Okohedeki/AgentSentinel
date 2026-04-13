// ---------------------------------------------------------------------------
// Handoff prompt generation — structured context for agent switching
// ---------------------------------------------------------------------------

import { ContextBusState } from './types';

/**
 * Generate a structured handoff prompt from the context bus state.
 * This prompt is injected into a new agent session so it can continue
 * work without re-reading files or re-calling tools.
 */
export function generateHandoffPrompt(state: ContextBusState): string {
  const sections: string[] = [];

  sections.push('## Task Handoff Context');
  sections.push('');

  if (state.taskState) {
    sections.push(`**Task:** ${state.taskState.taskDescription}`);
    sections.push('');

    if (state.taskState.completedSteps.length > 0) {
      sections.push('**What has been done:**');
      for (const step of state.taskState.completedSteps) {
        sections.push(`- ${step}`);
      }
      sections.push('');
    }

    if (state.taskState.blockers.length > 0) {
      sections.push('**Current blockers:**');
      for (const blocker of state.taskState.blockers) {
        sections.push(`- ${blocker}`);
      }
      sections.push('');
    }

    if (state.taskState.remainingSteps.length > 0) {
      sections.push('**Remaining steps:**');
      for (const step of state.taskState.remainingSteps) {
        sections.push(`- ${step}`);
      }
      sections.push('');
    }
  }

  if (state.fileOperations.length > 0) {
    sections.push('**Files touched:**');
    for (const op of state.fileOperations) {
      sections.push(`- ${op.operation.toUpperCase()} ${op.filePath} — ${op.reason}`);
    }
    sections.push('');
  }

  if (state.decisions.length > 0) {
    sections.push('**Key decisions made:**');
    for (const d of state.decisions) {
      sections.push(`- ${d.description}: ${d.rationale}`);
    }
    sections.push('');
  }

  // Instructions for the receiving agent
  sections.push('**Do NOT re-read files already read unless you need to verify recent changes.**');

  if (state.toolCallCache.length > 0) {
    sections.push('**Do NOT re-call tools with cached results below — use these directly:**');
    for (const tc of state.toolCallCache) {
      const inputStr = JSON.stringify(tc.input);
      const outputStr = typeof tc.output === 'string' ? tc.output : JSON.stringify(tc.output);
      // Truncate long outputs
      const truncated = outputStr.length > 200 ? outputStr.slice(0, 200) + '...' : outputStr;
      sections.push(`- ${tc.toolName}(${inputStr}) -> ${truncated}`);
    }
  }

  return sections.join('\n').trim();
}
