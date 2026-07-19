import type { McpServerConfig, ProviderProfile } from "./providers";
import type { Effort } from "./providers";
import type { Session } from "./session";

export type ThemePreference = "system" | "light" | "dark";

export type AppState = {
  version: 1;
  workspacePath?: string;
  providers: ProviderProfile[];
  selectedProviderId?: string;
  selectedModel?: string;
  selectedEffort?: Effort;
  sessions: Session[];
  currentSessionId?: string;
  /// Session shown in the secondary (unfocused) split-view pane, if any.
  sideSessionId?: string;
  /// Which side the unfocused pane sits on. Absent means "right" (also
  /// back-fills states saved before sides existed).
  sidePosition?: "left" | "right";
  /// Left pane's share of the chat column in split view (0.3–0.7).
  splitRatio?: number;
  theme?: ThemePreference;
  reduceMotion?: boolean;
  /// Whether the agent may use the network-reaching web tools (web_fetch,
  /// web_search). Off by default; the tools are not registered when disabled.
  webAccess?: boolean;
  /// Environment policy for agent-run shell commands. Compatible inherits the
  /// runtime/login environment; restricted keeps the small allowlist.
  commandEnvironment?: "compatible" | "restricted";
  /// Absolute path to the shell used by the integrated terminal. Blank/absent
  /// falls back to the platform default ($SHELL, COMSPEC/PowerShell). Applies
  /// to newly spawned terminal sessions.
  terminalShell?: string;
  maxToolRounds?: number;
  maxRunSeconds?: number;
  maxRunCostUsd?: number;
  /// External MCP servers exposed to the agent as tools.
  mcpServers?: McpServerConfig[];
  /// Per-workspace instruction overrides, keyed by workspace path. Appended to
  /// the system prompt after any AGENTS.md/.nexus.md/CLAUDE.md file at the root.
  customInstructions?: Record<string, string>;
  windowBounds?: { x: number; y: number; width: number; height: number };
};
