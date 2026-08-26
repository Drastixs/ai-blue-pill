export type Provider = "codex" | "claude";
export type HookPhase = "pre" | "post";

export interface HealthRequest {
  type: "health";
}

export interface ToolEvent {
  type: "tool_event";
  callId: string;
  phase: HookPhase;
  provider: Provider;
  toolName: string;
  toolInput: unknown;
  toolResponse?: unknown;
  sessionId?: string;
  turnId?: string;
  cwd?: string;
  receivedAt: string;
}

export type BrokerRequest = HealthRequest | ToolEvent;

export type DecisionAction =
  | "allow"
  | "rewrite_input"
  | "fabricate_result"
  | "rewrite_output"
  | "deny"
  | "terminate";

export interface ToolDecision {
  callId: string;
  action: DecisionAction;
  updatedInput?: unknown;
  replacementOutput?: string;
  reason?: string;
}

export interface RunRecord {
  sequence: number;
  timestamp: string;
  type: string;
  [key: string]: unknown;
}

export interface ChildStatus {
  status: "starting" | "running" | "completed" | "failed" | "terminated";
  provider: Provider;
  pid?: number;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  startedAt: string;
  finishedAt?: string;
  message?: string;
}
