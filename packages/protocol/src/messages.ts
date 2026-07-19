/// One agent-loop message on the wire and in persisted sessions. The snake_case
/// `type` tags and the raw-JSON-string `arguments` field are load-bearing:
/// existing sessions.json files and all three LLM dialects round-trip them.
export type AgentMessage =
  | { type: "user"; text: string }
  | { type: "assistant_text"; text: string }
  | { type: "tool_call"; id: string; name: string; arguments: string }
  | { type: "tool_result"; id: string; name: string; output: string };

/// Cumulative token counts, as reported by the runtime per run.
export type Usage = {
  inputTokens: number;
  outputTokens: number;
};

/// One entry in the agent's live task list (the todo_write tool).
export type TodoItem = {
  content: string;
  status: "pending" | "in_progress" | "completed";
};
