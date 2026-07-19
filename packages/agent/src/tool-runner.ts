import type { McpHub } from "@nexus/mcp";
import type { AgentMessage, RuntimeEmitter } from "@nexus/protocol";
import { asRecord, asString, ToolError } from "@nexus/protocol";
import type { ToolCall } from "@nexus/providers";
import {
  applyMutation,
  type CommandEnvironment,
  isAvailable,
  kindOf,
  planMutation,
  type Toolbox,
  webFetch,
  webSearch,
} from "@nexus/tools";
import type { CheckpointRecorder } from "@nexus/workspace";
import type { ApprovalMailbox } from "./approvals";
import { runCommandTool } from "./command-tool";
import { type ApprovalMode, requiresApproval, toolMode } from "./modes";
import type { SubagentLauncher } from "./subagent";
import { summarizeArgs } from "./summarize-args";
import { memoryTool, planTool, researchTool, todoTool } from "./ui-tools";

/// Longest before/after preview sent in an approval_request event. The full
/// content is still written on approval; this only bounds the UI payload.
const APPROVAL_PREVIEW_LIMIT = 50_000;

const cap = (text: string, limit: number) => [...text].slice(0, limit).join("");

/// Model-supplied arguments arrive as a raw JSON string; the tool layer takes
/// the parsed object (unparseable input degrades to {}, like the Rust).
function parseToolArgs(argumentsJson: string): unknown {
  try {
    return JSON.parse(argumentsJson);
  } catch {
    return {};
  }
}

/// Formats a thrown tool failure into the model-facing sentence the Rust
/// runtime returned inline ("Error: <one sentence>"). A failed tool call is
/// conversation content — it must never abort the run.
function toolFailure(error: unknown): string {
  if (error instanceof ToolError) return `Error: ${error.message}`;
  throw error;
}

/// Everything one tool call needs. Shared by reference across the run loop.
export class ToolRunner {
  constructor(
    private options: {
      fetchFn: typeof fetch;
      toolbox: Toolbox;
      workspace: string;
      hub: McpHub;
      emitter: RuntimeEmitter;
      mode: ApprovalMode;
      commandEnvironment: CommandEnvironment;
      webAccess: boolean;
      subagent: SubagentLauncher;
      signal: AbortSignal;
      commandTimeoutMs?: number;
    },
  ) {}

  get emitter(): RuntimeEmitter {
    return this.options.emitter;
  }

  get signal(): AbortSignal {
    return this.options.signal;
  }

  /// Runs one tool call: pushes ToolCall/ToolResult into history, emits the
  /// tool_call/tool_result events, dispatches by ToolKind, and gates
  /// mutations and commands behind approval in Ask mode. Returns the
  /// model-facing output.
  async execute(
    messages: AgentMessage[],
    checkpoint: CheckpointRecorder,
    mailbox: ApprovalMailbox,
    call: ToolCall,
  ): Promise<string> {
    const { id, name } = call;
    const argumentsJson = call.arguments;
    messages.push({ type: "tool_call", id, name, arguments: argumentsJson });
    this.options.emitter.emit({
      type: "tool_call",
      id,
      name,
      summary: summarizeArgs(argumentsJson),
      arguments: argumentsJson,
    });

    const output = await this.dispatch(
      id,
      name,
      argumentsJson,
      checkpoint,
      mailbox,
    );

    messages.push({ type: "tool_result", id, name, output });
    this.options.emitter.emit({
      type: "tool_result",
      id,
      name,
      preview: cap(output, 600),
    });
    return output;
  }

  private async dispatch(
    id: string,
    name: string,
    argumentsJson: string,
    checkpoint: CheckpointRecorder,
    mailbox: ApprovalMailbox,
  ): Promise<string> {
    const { emitter, mode } = this.options;
    const mode3 = toolMode(mode);
    // Built-in tools dispatch on their catalog kind; anything unknown falls
    // through to the MCP hub outside Research mode. Schema filtering is the
    // primary capability boundary; repeat it at dispatch so a provider
    // cannot execute an unavailable built-in by hallucinating its name.
    const kind = kindOf(name);
    if (kind !== undefined && !isAvailable(name, this.options.webAccess, mode3))
      return `Error: tool "${name}" is unavailable in this mode.`;
    switch (kind) {
      case "command":
        return runCommandTool({
          workspace: this.options.workspace,
          emitter,
          mode,
          commandEnvironment: this.options.commandEnvironment,
          mailbox,
          callId: id,
          argumentsJson,
          signal: this.options.signal,
          timeoutMs: this.options.commandTimeoutMs,
        });
      case "todo":
        return todoTool(emitter, id, argumentsJson);
      case "plan":
        return planTool(emitter, id, argumentsJson);
      case "research":
        return researchTool(emitter, id, argumentsJson);
      case "web":
        return this.webTool(name, argumentsJson);
      case "memory":
        return memoryTool(this.options.workspace, name, argumentsJson);
      case "subAgent": {
        let parsed: unknown;
        try {
          parsed = JSON.parse(argumentsJson);
        } catch {
          parsed = {};
        }
        const task = asString(asRecord(parsed)?.task);
        if (task === undefined || task.trim().length === 0)
          return 'Error: spawn_agent requires a non-empty "task" string.';
        return this.options.subagent.launch(
          this.options.fetchFn,
          this.options.toolbox,
          emitter,
          id,
          task,
          this.options.signal,
        );
      }
      case "mutating": {
        let plan: Awaited<ReturnType<typeof planMutation>>;
        try {
          plan = await planMutation(
            this.options.workspace,
            name,
            parseToolArgs(argumentsJson),
          );
        } catch (error) {
          return toolFailure(error);
        }
        const entries = checkpoint.entriesFor(plan);
        let approved = true;
        if (requiresApproval(mode)) {
          emitter.emit({
            type: "approval_request",
            kind: "edit",
            callId: id,
            tool: name,
            path: plan.path,
            before: cap(plan.before, APPROVAL_PREVIEW_LIMIT),
            after:
              plan.after === null
                ? null
                : cap(plan.after, APPROVAL_PREVIEW_LIMIT),
          });
          approved = await mailbox.wait(id, this.options.signal);
        }
        if (!approved) return "The user declined this edit.";
        try {
          const output = await applyMutation(this.options.workspace, plan);
          checkpoint.record(entries);
          return output;
        } catch (error) {
          return toolFailure(error);
        }
      }
      case "readOnly": {
        try {
          return await this.options.toolbox.execute(
            name,
            parseToolArgs(argumentsJson),
            this.options.signal,
          );
        } catch (error) {
          return toolFailure(error);
        }
      }
      case undefined: {
        if (mode === "research")
          return "Error: external MCP tools are unavailable in Deep Research mode.";
        if (this.options.hub.has(name)) {
          let approved = true;
          if (requiresApproval(mode)) {
            emitter.emit({
              type: "approval_request",
              kind: "mcp",
              callId: id,
              tool: name,
              arguments: argumentsJson,
            });
            approved = await mailbox.wait(id, this.options.signal);
          }
          if (!approved) return "The user declined this tool call.";
          try {
            return await this.options.hub.call(name, argumentsJson);
          } catch (error) {
            return toolFailure(error);
          }
        }
        return `Error: unknown tool "${name}".`;
      }
    }
  }

  private async webTool(name: string, argumentsJson: string): Promise<string> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(argumentsJson);
    } catch {
      parsed = {};
    }
    try {
      if (name === "web_fetch") {
        const url = asString(asRecord(parsed)?.url);
        if (url === undefined) return 'Error: "url" is required.';
        return await webFetch(url, this.options.signal, this.options.fetchFn);
      }
      const query = (asString(asRecord(parsed)?.query) ?? "").trim();
      if (query.length === 0) return 'Error: "query" is required.';
      return await webSearch(query, this.options.signal, this.options.fetchFn);
    } catch (error) {
      return toolFailure(error);
    }
  }
}
