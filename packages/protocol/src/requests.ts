import type { ApprovalMode } from "./approvals";
import type { AgentMessage } from "./messages";
import type { Effort, McpServerConfig } from "./providers";

/// Parameters for starting an agent run. Electron-internal IPC type — the
/// main process augments it with providerKind/auth before hitting the runtime.
export type StartAgentParams = {
  providerId: string;
  model: string;
  effort?: Effort;
  approvalMode: ApprovalMode;
  workspacePath: string;
  history: AgentMessage[];
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
