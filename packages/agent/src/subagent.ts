import type { AgentMessage, Effort, RuntimeEmitter } from "@nexus/protocol";
import { nullEmitter, ToolError } from "@nexus/protocol";
import {
  AnthropicProvider,
  anthropicWrapSchema,
  type Headers,
  KIMI_API_KEY_ENDPOINT,
  KIMI_OAUTH_ENDPOINT,
  OpenAiProvider,
  openaiWrapSchema,
  type Provider,
  type ProviderKind,
} from "@nexus/providers";
import { kindOf, type Toolbox, toolSchemas } from "@nexus/tools";
import { SUBAGENT_PROMPT } from "./prompts";
import { summarizeArgs } from "./summarize-args";

/// The sub-agent's per-run step budget: enough for real investigation,
/// bounded so a runaway loop can't burn the parent run's budget.
const SUBAGENT_MAX_ITERATIONS = 12;

/// The parent run's resolved credential, reused by nested sub-agents.
export type Credential =
  | { kind: "api_key"; apiKey: string }
  | { kind: "oauth"; accessToken: string; accountId?: string };

/// The read-only slice of the tool catalog, wrapped for a provider dialect.
/// This is exactly the tool set a research sub-agent is allowed.
export function readonlyToolSchemas(
  wrap: (name: string, description: string, parameters: unknown) => unknown,
): unknown[] {
  return toolSchemas(false, "standard")
    .filter((schema) => schema.kind === "readOnly")
    .map((schema) => wrap(schema.name, schema.description, schema.parameters));
}

/// Builds a nested read-only provider from the parent run's backend/model and
/// runs it to completion. Carried on the ToolRunner so `spawn_agent` can
/// launch without knowing which backend the run uses.
export class SubagentLauncher {
  constructor(
    private options: {
      kind: ProviderKind;
      model: string;
      effort: Effort;
      credential: Credential;
      /// Kimi OAuth device headers (empty for other providers).
      kimiHeaders?: Headers;
    },
  ) {}

  /// Runs a sub-agent over `task` and returns its final answer (or an error
  /// string). Progress is streamed as `subagent_step` events tagged with the
  /// parent call id; the sub-agent's own provider deltas go to a null
  /// emitter so they never surface in the main transcript.
  async launch(
    fetchFn: typeof fetch,
    toolbox: Toolbox,
    emitter: RuntimeEmitter,
    callId: string,
    task: string,
    signal: AbortSignal,
  ): Promise<string> {
    const messages: AgentMessage[] = [{ type: "user", text: task }];
    const { kind, model, effort, credential } = this.options;
    let provider: Provider;
    if (kind === "Anthropic") {
      if (credential.kind !== "api_key")
        return "The sub-agent could not start: credential mismatch.";
      provider = AnthropicProvider.anthropic(
        model,
        effort,
        SUBAGENT_PROMPT,
        credential.apiKey,
        readonlyToolSchemas(anthropicWrapSchema),
      );
    } else if (kind === "Kimi") {
      const [endpoint, headers]: [string, Headers] =
        credential.kind === "api_key"
          ? [
              KIMI_API_KEY_ENDPOINT,
              [["Authorization", `Bearer ${credential.apiKey}`]],
            ]
          : [
              KIMI_OAUTH_ENDPOINT,
              [
                ...(this.options.kimiHeaders ?? []),
                ["Authorization", `Bearer ${credential.accessToken}`],
              ],
            ];
      provider = new AnthropicProvider(
        "Kimi",
        model,
        effort,
        SUBAGENT_PROMPT,
        endpoint,
        headers,
        readonlyToolSchemas(anthropicWrapSchema),
      );
    } else {
      // No response-id chaining for the sub-agent: it starts fresh and
      // replays its own short history.
      provider = new OpenAiProvider(
        model,
        effort,
        SUBAGENT_PROMPT,
        credential.kind === "api_key"
          ? { kind: "api-key", apiKey: credential.apiKey }
          : {
              kind: "chatgpt",
              accessToken: credential.accessToken,
              accountId: credential.accountId,
            },
        undefined,
        messages,
        readonlyToolSchemas(openaiWrapSchema),
      );
    }
    return runSubagentLoop(
      provider,
      fetchFn,
      toolbox,
      emitter,
      callId,
      messages,
      signal,
    );
  }
}

/// The sub-agent's inner loop: ask the provider for a turn, run any read-only
/// tool calls (rejecting anything else), and repeat until a turn requests no
/// tools or the step budget is spent. Returns the last assistant text as the
/// answer. Exported so a scripted fake provider can drive it in tests.
export async function runSubagentLoop(
  provider: Provider,
  fetchFn: typeof fetch,
  toolbox: Toolbox,
  emitter: RuntimeEmitter,
  callId: string,
  history: AgentMessage[],
  signal: AbortSignal,
): Promise<string> {
  const messages = [...history];
  let answer = "";
  for (let step = 0; step < SUBAGENT_MAX_ITERATIONS; step += 1) {
    let turn: Awaited<ReturnType<Provider["turn"]>>;
    try {
      turn = await provider.turn(fetchFn, messages, nullEmitter, signal);
    } catch (error) {
      return `The sub-agent failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    for (const text of turn.texts) {
      if (text.trim().length > 0) answer = text;
      messages.push({ type: "assistant_text", text });
    }
    if (turn.toolCalls.length === 0) {
      return answer.length === 0
        ? "The sub-agent finished without producing an answer."
        : answer;
    }
    for (const call of turn.toolCalls) {
      messages.push({
        type: "tool_call",
        id: call.id,
        name: call.name,
        arguments: call.arguments,
      });
      emitter.emit({
        type: "subagent_step",
        callId,
        tool: call.name,
        summary: summarizeArgs(call.arguments),
      });
      // Read-only built-ins only; the sub-agent must never mutate or run
      // commands, so anything else returns an error it can react to.
      let output: string;
      if (kindOf(call.name) === "readOnly") {
        let parsedArgs: unknown;
        try {
          parsedArgs = JSON.parse(call.arguments);
        } catch {
          parsedArgs = {};
        }
        try {
          output = await toolbox.execute(call.name, parsedArgs, signal);
        } catch (error) {
          output =
            error instanceof ToolError
              ? `Error: ${error.message}`
              : `Error: ${error instanceof Error ? error.message : String(error)}`;
        }
      } else {
        output = `Error: the sub-agent may only use read-only tools; "${call.name}" is not available to it.`;
      }
      provider.noteToolOutput(call.id, output);
      messages.push({
        type: "tool_result",
        id: call.id,
        name: call.name,
        output,
      });
    }
  }
  return answer.length === 0
    ? "The sub-agent reached its step limit without reaching a conclusion."
    : `${answer}\n\n(The sub-agent stopped at its step limit; this may be partial.)`;
}
