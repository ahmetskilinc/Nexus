/// A tool discovered on a server, in the form the agent loop needs: the
/// exposed (namespaced) name, its description, and its JSON Schema.
export type McpToolInfo = {
  name: string;
  description: string;
  inputSchema: unknown;
};

/// The name/description pair the desktop app shows when inspecting a server.
export type McpToolSummary = {
  name: string;
  description: string;
};

export type McpHubOptions = {
  /// Per-request timeout; defaults to 30s. Injectable so tests can exercise
  /// the timeout path without waiting.
  timeoutMs?: number;
};
