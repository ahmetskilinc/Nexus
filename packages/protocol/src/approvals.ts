/// How the agent operates: apply file edits immediately ("auto"), wait for the
/// user to approve each one ("ask"), deeply investigate with read-only tools
/// ("research"), or publish and execute a feature plan ("plan").
export type ApprovalMode = "auto" | "ask" | "research" | "plan";

/// A tool call awaiting the user's decision. An edit carries a before/after
/// diff (`after` null = deletion); a command carries the shell command string;
/// an MCP call carries the namespaced tool name and its raw JSON arguments.
export type ApprovalRequest =
  | {
      kind: "edit";
      callId: string;
      tool: string;
      path: string;
      before: string;
      after: string | null;
    }
  | {
      kind: "command";
      callId: string;
      tool: string;
      command: string;
    }
  | {
      kind: "mcp";
      callId: string;
      tool: string;
      arguments: string;
    };

/// An approval request held in ephemeral renderer state while the agent loop
/// is paused, tagged with the run it belongs to.
export type PendingApproval = ApprovalRequest & { runId: string };
