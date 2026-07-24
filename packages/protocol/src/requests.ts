import type { ApprovalMode } from "./approvals";
import type { AgentMessage } from "./messages";
import type { Effort, McpServerConfig } from "./providers";

/// An image held only in renderer memory for the request that carries it. Its
/// data URL must never be copied into session state, exports, journals, or logs.
export type EphemeralImage = {
  name: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  dataUrl: string;
  size: number;
};

/// Parameters for starting an agent run. Electron-internal IPC type — the
/// main process augments it with providerKind/auth before hitting the runtime.
export type StartAgentParams = {
  providerId: string;
  model: string;
  effort?: Effort;
  approvalMode: ApprovalMode;
  workspacePath: string;
  history: AgentMessage[];
  /// Ephemeral images forwarded directly to the selected provider on this
  /// request only. They are intentionally absent from `history`.
  images?: EphemeralImage[];
  previousOpenAIResponseId?: string;
  webAccess: boolean;
  commandEnvironment: "compatible" | "restricted";
  maxToolRounds: number;
  maxRunSeconds: number;
  maxRunCostUsd?: number;
  mcpServers: McpServerConfig[];
  /// Per-workspace instruction override for this run's workspace, if any.
  customInstructions?: string;
};

/// Parameters for compacting a session's history on demand. A summarizer
/// round-trip needs far less than a run: no tools, no MCP servers, no
/// approval mode, no budgets. Electron-internal IPC type, augmented with
/// providerKind/auth by the main process like `StartAgentParams`.
export type CompactAgentParams = {
  providerId: string;
  model: string;
  workspacePath: string;
  history: AgentMessage[];
};
