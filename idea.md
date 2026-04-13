AgentSentinel — Build Prompt for Claude Code
What You Are Building
An automated quality recovery system for AI coding agents. Not a monitoring dashboard. Not a logger. A system that detects when Claude Code, Codex, or Gemini degrades mid-session, diagnoses the failure mode, and applies one of four recovery levers automatically — without requiring human intervention or losing session state.
The core insight: enterprises running coding agents at scale are locked out of model weights. They cannot fine-tune, retrain, or patch a model that starts underperforming after an Anthropic/OpenAI update. They need infrastructure that detects degradation and recovers from it programmatically. That infrastructure does not exist. Build it.

Technical Architecture
System Components
┌─────────────────────────────────────────────────────────────┐
│                     AGENT SENTINEL                          │
│                                                             │
│  ┌──────────────┐    ┌───────────────┐    ┌─────────────┐  │
│  │  WATCHER     │    │  CONTEXT BUS  │    │  RECOVERY   │  │
│  │              │───▶│               │───▶│  ENGINE     │  │
│  │ reads JSONL  │    │ shared state  │    │             │  │
│  │ computes     │    │ across agents │    │ applies     │  │
│  │ metrics      │    │               │    │ levers      │  │
│  └──────────────┘    └───────────────┘    └─────────────┘  │
│         │                    │                    │         │
│         ▼                    ▼                    ▼         │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              AGENT ORCHESTRATOR                       │  │
│  │  claude-squad / OpenClaw / Parallel Code integration  │  │
│  │  routes tasks to Claude Code, Codex, Gemini          │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
Directory Structure
agent-sentinel/
├── packages/
│   ├── watcher/              # Session log ingestion and metrics
│   ├── context-bus/          # Shared state store across agents  
│   ├── recovery-engine/      # The four levers
│   ├── orchestrator/         # Multi-agent routing layer
│   └── cli/                  # Developer-facing terminal UI
├── integrations/
│   ├── claude-code/          # Hooks into Claude Code session JSONL
│   ├── codex/                # Codex CLI adapter
│   ├── gemini/               # Gemini CLI adapter
│   └── cursor/               # Cursor agent adapter
├── config/
│   ├── sentinel.config.ts    # User configuration
│   └── quality-floor.ts      # Degradation thresholds
├── scripts/
│   └── install-hooks.sh      # Installs Claude Code hooks automatically
└── dashboard/                # Optional local web UI (Vite + React)

Package Dependencies
Core Runtime
json{
  "dependencies": {
    "chokidar": "^3.6.0",          // Watch ~/.claude/projects/ JSONL files
    "better-sqlite3": "^9.4.3",    // Local metrics store — fast, no server
    "zod": "^3.22.4",              // Schema validation for JSONL parsing
    "commander": "^12.0.0",        // CLI framework
    "ink": "^4.4.1",               // React-based terminal UI
    "node-pty": "^1.0.0",          // Spawn and control agent subprocesses
    "execa": "^8.0.1",             // Run agent CLIs programmatically
    "p-queue": "^8.0.1",           // Concurrency control for parallel agents
    "eventemitter3": "^5.0.1",     // Event bus for internal messaging
    "chalk": "^5.3.0",             // Terminal color output
    "ora": "^8.0.1",               // Terminal spinners
    "conf": "^12.0.0",             // Persistent user config
    "mlly": "^1.6.1",              // ESM utilities
    "tsx": "^4.7.1"                // TypeScript execution
  },
  "devDependencies": {
    "typescript": "^5.4.2",
    "vitest": "^1.4.0",
    "@types/better-sqlite3": "^7.6.8",
    "@types/node": "^20.11.5"
  }
}
Optional Dashboard
json{
  "dependencies": {
    "vite": "^5.1.4",
    "react": "^18.2.0",
    "recharts": "^2.12.2",         // Metric trend charts
    "@tanstack/react-query": "^5.28.0"
  }
}

Component 1: The Watcher
File: packages/watcher/src/index.ts
What it does: Reads Claude Code session JSONL files in real time from ~/.claude/projects/**/*.jsonl. Computes quality metrics on a rolling window. Emits degradation events when metrics cross thresholds.
Metrics to compute:
typescriptinterface SessionMetrics {
  // Primary degradation signals
  readEditRatio: number;           // reads / edits — healthy: >4.0, degraded: <2.0
  thinkingDepthScore: number;      // proxy via thinking block signature length
  autonomousRunMinutes: number;    // minutes between human interventions
  userInterruptRate: number;       // interrupts per hour
  editsWithoutPriorRead: number;   // % of edits where no read preceded them
  
  // Secondary signals
  lazyLanguageFrequency: number;   // "simplest", "straightforward", "just" per 1000 tokens
  reasoningLoopCount: number;      // "actually", "wait", "let me reconsider" occurrences
  toolCallSuccessRate: number;     // successful tool calls / total tool calls
  
  // Session context
  sessionId: string;
  agentType: 'claude-code' | 'codex' | 'gemini' | 'cursor';
  modelVersion: string;
  timestamp: Date;
  windowMinutes: number;           // rolling window size
}

interface DegradationEvent {
  sessionId: string;
  severity: 'warning' | 'critical';
  failureMode: FailureMode;
  metrics: SessionMetrics;
  recommendedLever: Lever;
}

type FailureMode = 
  | 'lazy-shortcuts'        // low read:edit, lazy language, edits without reads
  | 'reasoning-loops'       // high loop count, low autonomous run time
  | 'tool-failure'          // low tool call success rate
  | 'context-loss'          // inconsistent behavior on same files
  | 'output-drift';         // behavioral change vs baseline

type Lever = 'switch-model' | 'harden-prompt' | 'harden-harness' | 'eval-loop';
JSONL parsing target:
The files at ~/.claude/projects/<project-hash>/sessions/<session-id>.jsonl contain newline-delimited JSON. Each line is one event. Parse for:

type: "tool_use" with name: "Read" or name: "Edit" — for read:edit ratio
type: "thinking" — extract signature field length as thinking depth proxy
type: "user" with content containing interrupt signals
type: "text" in assistant messages — scan for lazy language patterns


Component 2: The Context Bus
File: packages/context-bus/src/index.ts
What it does: A shared state store that every agent writes to and reads from. Solves the context handoff problem — when you switch from Claude to Codex mid-session, Codex reads the bus and gets full state without needing the conversation history.
Schema:
typescriptinterface ContextBus {
  sessionId: string;
  projectPath: string;
  taskDescription: string;
  
  // File state — what was read, what was changed, why
  fileOperations: FileOperation[];
  
  // Tool call results — so the next agent doesn't re-call
  toolCallCache: ToolCallResult[];
  
  // Decisions made — rationale the next agent needs
  decisions: Decision[];
  
  // Current task state
  taskState: {
    started: Date;
    lastActivity: Date;
    completedSteps: string[];
    remainingSteps: string[];
    blockers: string[];
  };
  
  // Agent history — which models ran, quality scores, handoff reasons
  agentHistory: AgentRun[];
}

interface FileOperation {
  path: string;
  operation: 'read' | 'edit' | 'create' | 'delete';
  timestamp: Date;
  agentId: string;
  reason: string;          // extracted from agent's reasoning
  beforeHash?: string;     // content hash before edit
  afterHash?: string;      // content hash after edit
}

interface ToolCallResult {
  toolName: string;
  input: Record<string, unknown>;
  output: unknown;
  timestamp: Date;
  ttlSeconds: number;      // how long this result is valid for re-use
}

interface Decision {
  description: string;
  rationale: string;
  timestamp: Date;
  agentId: string;
  reversible: boolean;
}

interface AgentRun {
  agentType: string;
  modelVersion: string;
  startTime: Date;
  endTime?: Date;
  qualityScore: number;
  handoffReason?: string;
  lever?: Lever;
}
Context injection — the handoff prompt generator:
When switching agents, generate a structured handoff prompt from the bus:
typescriptfunction generateHandoffPrompt(bus: ContextBus): string {
  return `
## Task Handoff Context

**Task:** ${bus.taskDescription}

**What has been done:**
${bus.taskState.completedSteps.map(s => `- ${s}`).join('\n')}

**Files touched:**
${bus.fileOperations.map(op => 
  `- ${op.operation.toUpperCase()} ${op.path} — ${op.reason}`
).join('\n')}

**Key decisions made:**
${bus.decisions.map(d => 
  `- ${d.description}: ${d.rationale}`
).join('\n')}

**Current blockers:**
${bus.taskState.blockers.map(b => `- ${b}`).join('\n')}

**Remaining steps:**
${bus.taskState.remainingSteps.map(s => `- ${s}`).join('\n')}

**Do NOT re-read files already read unless you need to verify recent changes.**
**Do NOT re-call tools with cached results below — use these directly:**
${bus.toolCallCache.map(tc => 
  `- ${tc.toolName}(${JSON.stringify(tc.input)}) → already returned: ${JSON.stringify(tc.output)}`
).join('\n')}
`.trim();
}
Storage: SQLite via better-sqlite3. One database per project at <project>/.sentinel/context.db. Fast, local, no server required.

Component 3: The Recovery Engine — The Four Levers
File: packages/recovery-engine/src/levers/
Lever 1: Switch Model
typescript// packages/recovery-engine/src/levers/switch-model.ts

interface ModelRouter {
  primary: AgentConfig;
  fallbacks: AgentConfig[];       // ordered by preference
  qualityFloor: number;           // score below which we switch
  switchCooldownMs: number;       // prevent thrashing
}

interface AgentConfig {
  type: 'claude-code' | 'codex' | 'gemini' | 'cursor';
  model: string;
  bin: string;                    // path to CLI binary
  args: string[];                 // default args
  contextStrategy: 'handoff-prompt' | 'worktree' | 'shared-memory';
}

async function switchModel(
  event: DegradationEvent,
  bus: ContextBus,
  router: ModelRouter
): Promise<AgentSession> {
  // 1. Select next agent from fallback chain
  const nextAgent = selectNextAgent(router, event);
  
  // 2. Generate handoff prompt from context bus
  const handoffPrompt = generateHandoffPrompt(bus);
  
  // 3. Spawn new agent subprocess with handoff context
  const session = await spawnAgent(nextAgent, {
    cwd: bus.projectPath,
    initialPrompt: handoffPrompt,
    inheritToolConnections: true,   // reuse MCP server connections
  });
  
  // 4. Log the switch in agent history
  bus.agentHistory.push({
    agentType: nextAgent.type,
    modelVersion: nextAgent.model,
    startTime: new Date(),
    qualityScore: 1.0,
    handoffReason: event.failureMode,
    lever: 'switch-model',
  });
  
  return session;
}
Packages needed for agent spawning: node-pty for persistent PTY sessions, execa for one-shot commands, OpenClaw patterns for multi-engine management.
Lever 2: Prompt Hardening
typescript// packages/recovery-engine/src/levers/prompt-hardening.ts

// Library of compensating prompts keyed by failure mode
const COMPENSATING_PROMPTS: Record<FailureMode, CompensatingPrompt[]> = {
  'lazy-shortcuts': [
    {
      id: 'force-read-before-edit',
      injection: `REQUIREMENT: Before editing any file, you MUST first read its current contents 
                  using the Read tool. Do not assume you know what a file contains. 
                  If you cannot read it first, do not edit it.`,
      position: 'system-prepend',
      priority: 1,
    },
    {
      id: 'ban-lazy-language',
      injection: `PROHIBITED: Do not use phrases like "the simplest approach", "just", 
                  "straightforward", or "quick fix". These signal shallow analysis. 
                  Show your work. Explain your reasoning for every decision.`,
      position: 'system-prepend',
      priority: 2,
    },
  ],
  'reasoning-loops': [
    {
      id: 'force-hypothesis-commitment',
      injection: `REQUIREMENT: State your hypothesis once. Commit to it. Test it. 
                  If it fails, explicitly state "Hypothesis failed because X" 
                  before forming a new one. Do not loop silently.`,
      position: 'system-prepend',
      priority: 1,
    },
  ],
  'context-loss': [
    {
      id: 'force-context-verification',
      injection: `REQUIREMENT: Before taking any action, state what you know about 
                  the current state of the task. Reference specific files and 
                  decisions from the session history above.`,
      position: 'system-prepend',
      priority: 1,
    },
  ],
  // ... other failure modes
};

interface CompensatingPrompt {
  id: string;
  injection: string;
  position: 'system-prepend' | 'system-append' | 'user-prepend';
  priority: number;
}

// Prompts are version-controlled in .sentinel/prompts/
// Each activation is logged with the metric state that triggered it
async function hardenPrompt(
  event: DegradationEvent,
  sessionId: string
): Promise<void> {
  const prompts = COMPENSATING_PROMPTS[event.failureMode];
  const sorted = prompts.sort((a, b) => a.priority - b.priority);
  
  // Write to Claude Code's settings.json for the current session
  // Claude Code reads from ~/.claude/settings.json and project-level .claude/settings.json
  await injectIntoClaudeSettings(sorted, sessionId);
  
  // Log which prompts were activated and why
  await logPromptActivation(sorted, event);
}
Lever 3: Harness Hardening
typescript// packages/recovery-engine/src/levers/harness-hardening.ts

// Claude Code hooks fire before/after tool calls
// Defined in .claude/settings.json under "hooks"
interface HarnesRule {
  id: string;
  trigger: 'PreToolUse' | 'PostToolUse' | 'Stop' | 'Notification';
  toolName?: string;
  condition: (context: HookContext) => boolean;
  action: HarnessAction;
}

type HarnessAction = 
  | { type: 'block'; reason: string }          // block the tool call
  | { type: 'require-read-first'; path: string } // force read before edit
  | { type: 'require-test-pass' }               // run tests before accepting
  | { type: 'log-and-continue' };               // observe without blocking

const HARNESS_RULES: Record<FailureMode, HarnessRule[]> = {
  'lazy-shortcuts': [
    {
      id: 'block-edit-without-read',
      trigger: 'PreToolUse',
      toolName: 'Edit',
      condition: (ctx) => !ctx.sessionReadHistory.includes(ctx.toolInput.file_path),
      action: { 
        type: 'block', 
        reason: 'Must read file before editing. Use Read tool first.' 
      },
    },
  ],
  'tool-failure': [
    {
      id: 'require-test-on-edit',
      trigger: 'PostToolUse',
      toolName: 'Edit',
      condition: (ctx) => ctx.testFileExists,
      action: { type: 'require-test-pass' },
    },
  ],
};

// Generate Claude Code hook scripts from rules
// Claude Code hooks are bash scripts in .claude/hooks/
function generateHookScript(rule: HarnessRule): string {
  // Claude Code executes hooks via stdin/stdout protocol
  // Hook receives JSON on stdin, writes JSON response to stdout
  return `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
// Rule: ${rule.id}
// ... enforcement logic
process.stdout.write(JSON.stringify({ allow: true/false, reason: '...' }));
`;
}
Lever 4: Eval-Driven Prompt Iteration
typescript// packages/recovery-engine/src/levers/eval-loop.ts

// Golden dataset: tasks with known correct outputs
// Stored in .sentinel/evals/
interface EvalCase {
  id: string;
  taskPrompt: string;
  codebase: string;             // git commit hash of test codebase
  expectedBehaviors: string[];  // what the agent should do
  forbiddenBehaviors: string[]; // what the agent must NOT do
  qualityDimensions: QualityDimension[];
}

interface QualityDimension {
  name: string;
  weight: number;               // 0-1, must sum to 1.0 across dimensions
  scorer: 'llm-as-judge' | 'deterministic' | 'regex';
  rubric: string;               // scoring instructions for LLM judge
}

// When degradation is detected:
// 1. Run current prompt config against golden dataset
// 2. Score outputs across quality dimensions
// 3. If score < baseline, trigger prompt optimization loop
// 4. Candidate prompts are tested against golden dataset
// 5. Best candidate is deployed automatically

async function runEvalLoop(
  event: DegradationEvent,
  evalCases: EvalCase[],
  currentPromptConfig: PromptConfig
): Promise<PromptConfig> {
  const baselineScore = await scorePromptConfig(currentPromptConfig, evalCases);
  
  const candidates = generatePromptCandidates(currentPromptConfig, event);
  const scored = await Promise.all(
    candidates.map(async (candidate) => ({
      config: candidate,
      score: await scorePromptConfig(candidate, evalCases),
    }))
  );
  
  const best = scored.sort((a, b) => b.score - a.score)[0];
  
  if (best.score > baselineScore) {
    await deployPromptConfig(best.config);
    await logPromptImprovement(baselineScore, best.score, event);
    return best.config;
  }
  
  return currentPromptConfig; // no improvement found, hold current
}

Component 4: The Orchestrator
File: packages/orchestrator/src/index.ts
Wraps claude-squad, OpenClaw, and Parallel Code patterns into a unified interface. Single entry point for launching and managing multi-agent sessions.
Key integrations:
typescript// OpenClaw for multi-engine session management
// github.com/Enderfga/openclaw-claude-code
import { SessionManager } from 'openclaw';

// claude-squad for terminal multiplexing
// github.com/smtg-ai/claude-squad  
import { Squad } from 'claude-squad';

// Parallel Code for git worktree isolation
// github.com/johannesjo/parallel-code
import { WorktreeManager } from 'parallel-code';

class AgentOrchestrator {
  private sessionManager: SessionManager;  // OpenClaw
  private squad: Squad;                    // claude-squad
  private worktrees: WorktreeManager;      // Parallel Code
  private contextBus: ContextBus;
  private watcher: SessionWatcher;
  private recoveryEngine: RecoveryEngine;
  
  async launchPrimary(config: AgentConfig, task: string): Promise<void> {
    // Create isolated git worktree for this task
    const worktree = await this.worktrees.create(config.cwd, task);
    
    // Start agent session via OpenClaw
    const session = await this.sessionManager.startSession({
      name: `primary-${Date.now()}`,
      engine: config.type,
      model: config.model,
      cwd: worktree.path,
    });
    
    // Start watching session logs
    this.watcher.watch(session.id, (event) => {
      this.handleDegradation(event, session);
    });
    
    // Send initial task
    await session.send(task);
  }
  
  private async handleDegradation(
    event: DegradationEvent,
    session: AgentSession
  ): Promise<void> {
    const lever = event.recommendedLever;
    
    switch (lever) {
      case 'switch-model':
        await this.recoveryEngine.switchModel(event, this.contextBus);
        break;
      case 'harden-prompt':
        await this.recoveryEngine.hardenPrompt(event, session.id);
        break;
      case 'harden-harness':
        await this.recoveryEngine.hardenHarness(event, session.id);
        break;
      case 'eval-loop':
        await this.recoveryEngine.runEvalLoop(event, this.evalCases);
        break;
    }
  }
}

Component 5: The CLI
File: packages/cli/src/index.ts
typescript// Built with commander + ink (React for terminals)

// Usage:
//   sentinel start                    — start monitoring current session
//   sentinel status                   — show current metrics
//   sentinel config                   — configure thresholds and fallbacks
//   sentinel evals run                — run golden dataset evaluation
//   sentinel evals add                — add a new eval case
//   sentinel context show             — dump current context bus state
//   sentinel context clear            — reset context bus for new task
//   sentinel history                  — show agent run history and quality scores
//   sentinel dashboard                — open local web dashboard

Configuration
File: sentinel.config.ts (lives at project root or ~/.sentinel/config.ts)
typescriptimport { defineConfig } from 'agent-sentinel';

export default defineConfig({
  // Quality thresholds — below these triggers recovery
  qualityFloor: {
    readEditRatio: 2.5,           // below 2.5 = degraded
    thinkingDepthScore: 0.6,      // below 0.6 = degraded
    autonomousRunMinutes: 3,      // less than 3 mins before human = degraded
    userInterruptRate: 4,         // more than 4 interrupts/hour = degraded
    toolCallSuccessRate: 0.80,    // below 80% = degraded
  },
  
  // Rolling window for metric calculation
  metricsWindowMinutes: 15,
  
  // Model fallback chain — ordered by preference
  agents: [
    {
      type: 'claude-code',
      model: 'claude-opus-4-6',
      bin: 'claude',
      args: ['--dangerously-skip-permissions'],
      contextStrategy: 'handoff-prompt',
    },
    {
      type: 'codex',
      model: 'gpt-5.4',
      bin: 'codex',
      args: ['--approval-mode', 'auto-edit'],
      contextStrategy: 'handoff-prompt',
    },
    {
      type: 'gemini',
      model: 'gemini-3.1-pro',
      bin: 'gemini',
      args: [],
      contextStrategy: 'worktree',
    },
  ],
  
  // Recovery lever preferences per failure mode
  leverMapping: {
    'lazy-shortcuts': ['harden-harness', 'harden-prompt', 'switch-model'],
    'reasoning-loops': ['harden-prompt', 'switch-model'],
    'tool-failure': ['switch-model', 'harden-harness'],
    'context-loss': ['switch-model'],
    'output-drift': ['eval-loop', 'harden-prompt'],
  },
  
  // How many times to try a lever before escalating to the next
  leverRetryLimit: 2,
  
  // Minimum minutes between model switches (prevent thrashing)
  switchCooldownMinutes: 10,
  
  // Context bus settings
  contextBus: {
    toolCallCacheTtlSeconds: 300, // cache tool results for 5 minutes
    maxDecisions: 50,             // keep last 50 decisions in context
    maxFileOperations: 200,       // keep last 200 file ops
  },
  
  // Eval dataset location
  evalsDir: '.sentinel/evals',
  
  // Notification on recovery actions
  notifications: {
    onSwitch: true,
    onPromptHarden: false,
    onHarnessHarden: false,
    onEvalLoop: true,
  },
});

Claude Code Hooks Integration
Claude Code supports hooks that fire on specific events. AgentSentinel installs hooks automatically via scripts/install-hooks.sh.
Add to .claude/settings.json:
json{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit",
        "hooks": [
          {
            "type": "command",
            "command": "npx sentinel hook pre-edit"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit",
        "hooks": [
          {
            "type": "command", 
            "command": "npx sentinel hook post-edit"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "npx sentinel hook session-end"
          }
        ]
      }
    ]
  }
}
Hooks write tool call data to the context bus in real time. This is how the context bus stays current without polling.

Build This First (MVP Scope)
Start with exactly these three things. Nothing else.
1. The Watcher — read JSONL, compute read:edit ratio and thinking depth, write to SQLite, emit warning when below threshold. This is 200 lines of TypeScript. Packages: chokidar, better-sqlite3, zod.
2. The Context Bus — SQLite schema for file operations, tool call cache, decisions. The generateHandoffPrompt() function. No fancy routing yet — just state that persists across agent switches. Packages: better-sqlite3.
3. The CLI with sentinel status — Show current session metrics in the terminal. Read:edit ratio, thinking depth trend, time since last human intervention. One command, real output. Packages: commander, chalk, ink.
That's v0.1. Ship it. Everything else — model switching, prompt hardening, harness rules, eval loop — comes after someone is using the watcher and saying "okay now what do I do about this?"

What This Is NOT

Not a general LLM observability platform (LangSmith, Langfuse already exist)
Not an APM tool (Datadog already exists)
Not a chatbot interface
Not a hosted SaaS on day one — local-first, runs in the developer's terminal

The enterprise SaaS layer comes after the open source tool has traction. Open source drives adoption. Enterprise pays for the team dashboard, CI/CD integration, and the audit trail compliance teams need.

Pricing (Once You're Ready)

Open source CLI: Free. MIT licensed. This is your distribution.
Team dashboard: $30/seat/month. Aggregate metrics across engineering team. Model quality comparison. Which developers get the most value from agents.
Enterprise: $500/month flat. CI/CD integration. Automatic PR-level quality scoring. Model version regression alerts. Audit logs. SSO.

The enterprise customer is paying for insurance against a model update on a Tuesday breaking their engineering velocity across 50 developers. That's a clear, defensible ROI.
you can copy the claude-validate repo in the H drive to begin. Make a github repo.