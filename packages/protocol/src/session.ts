import type { ApprovalMode } from "./approvals";
import type { AgentMessage, TodoItem, Usage } from "./messages";
import type { Effort } from "./providers";

export type ArtifactRevision = {
  title: string;
  markdown: string;
  updatedAt: string;
};

export type SessionResearch = {
  title: string;
  markdown: string;
  updatedAt: string;
  revisions?: ArtifactRevision[];
};

/// The feature plan for a session, produced in Plan mode by the write_plan
/// tool and shown as a side-panel artifact. `todos` mirrors the latest
/// todo_write list so the panel can track execution progress.
export type SessionPlan = {
  title: string;
  markdown: string;
  todos: TodoItem[];
  updatedAt: string;
  revisions?: ArtifactRevision[];
};

export type TranscriptItem = {
  id: string;
  kind: "user" | "assistant" | "tool" | "info" | "error";
  title: string;
  detail: string;
  result?: string;
  toolCallId?: string;
  /// Raw JSON arguments for a tool call, used to render a per-tool summary.
  args?: string;
  /// run_command state: `running` while output streams; `exitCode`/`timedOut`
  /// are set once the command finishes (exitCode null = killed/timed out).
  running?: boolean;
  exitCode?: number | null;
  timedOut?: boolean;
  /// spawn_agent: the read-only steps the nested sub-agent has taken so far,
  /// each a short "Read src/x" style label. Drives the SubagentCard.
  subagentSteps?: string[];
};

export type RunCheckpoint = {
  id: string;
  createdAt: number;
  files: string[];
  restoredAt?: string;
};

export type Session = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  workspacePath: string;
  transcript: TranscriptItem[];
  history: AgentMessage[];
  /// Tokens and estimated cost summed across every run in this session.
  /// `costUsd` only accumulates runs whose model had catalog pricing.
  usage?: Usage;
  costUsd?: number;
  openAIResponseId?: string;
  providerId?: string;
  model?: string;
  effort?: Effort;
  approvalMode?: ApprovalMode;
  /// The latest feature plan published in Plan mode, shown in the plan panel.
  plan?: SessionPlan;
  /// The latest report published in Deep Research mode.
  research?: SessionResearch;
  /// First tokens (program names, e.g. "npm", "cargo") the user has chosen to
  /// always allow running without a prompt in this session.
  allowedCommands?: string[];
  /// Pinned sessions sort before the rest of their workspace group.
  pinned?: boolean;
  /// Archived sessions remain persisted but are hidden from the normal sidebar.
  archivedAt?: string;
  /// Workspace-relative paths the agent's mutation tools touched this session
  /// (deduped, insertion order), driving the "Review changes" panel.
  changedFiles?: string[];
  /// Latest reversible mutation checkpoint produced by a completed run.
  checkpoint?: RunCheckpoint;
};
