/// How the agent loop dispatches a tool call. `kindOf` (in schemas.ts) is
/// the single source of truth for routing — there is no parallel
/// name-matching table anywhere else.

export type ToolKind =
  /// Sync, workspace-reading; dispatched through `Toolbox.execute`.
  | "readOnly"
  /// Changes disk; routed through `planMutation`/`applyMutation` and, in
  /// Ask mode, gated behind user approval.
  | "mutating"
  /// The shell tool: async, streams output live, command-approval gated.
  | "command"
  /// Emits a `todos` UI event; touches nothing.
  | "todo"
  /// Pauses the current run to collect a focused user answer.
  | "askUser"
  /// Emits a `plan` UI event carrying a feature-plan document; touches
  /// nothing. Registered only in Plan mode.
  | "plan"
  /// Emits a `research` UI event carrying a read-only research report;
  /// touches nothing. Registered only in Research mode.
  | "research"
  /// Network-reaching read-only tools, registered only with web access.
  | "web"
  /// Per-workspace memory tools (`memory_save`/`memory_list`); read/write a
  /// JSONL store outside the repo. No approval gate — they never touch the
  /// workspace.
  | "memory"
  /// Spawns a nested read-only research agent (`spawn_agent`). No approval
  /// gate — the sub-agent has only read-only tools and never mutates.
  | "subAgent";

/// Which mode-specific capability set is exposed to a provider.
export type ToolMode = "standard" | "plan" | "research";

export interface ToolSchema {
  readonly name: string;
  readonly description: string;
  /// JSON Schema for the parameters, sent verbatim to LLM APIs.
  readonly parameters: Record<string, unknown>;
  readonly kind: ToolKind;
}
