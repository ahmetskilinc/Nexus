import type { AgentMessage, Effort, RuntimeEmitter } from "@nexus/protocol";
import { asArray, asString, get, nullEmitter } from "@nexus/protocol";
import { anthropicThinkingTier, supportsEffort } from "../capabilities";
import { openSse, SseParser } from "../sse";
import type { Headers, Provider, ProviderKind, ToolCall, Turn } from "../types";
import { ANTHROPIC_VERSION, usageFromValue } from "../types";
import { type AssembledMessage, ContentAssembler } from "./assembler";
import { messages } from "./fold";

export const MESSAGES_ENDPOINT = "https://api.anthropic.com/v1/messages";

/// The Anthropic Messages API adapter. Stateless between turns: tool feedback
/// rides in the canonical history, which every request re-folds via
/// `messages()`. The endpoint and auth headers are data, not code, so the same
/// adapter also drives Anthropic-compatible providers (Kimi/Moonshot).
export class AnthropicProvider implements Provider {
  constructor(
    private kind: ProviderKind,
    private model: string,
    private effort: Effort,
    private systemPrompt: string,
    private endpoint: string,
    private headers: Headers,
    private toolSchemas: unknown[],
  ) {}

  /// The stock Anthropic API-key configuration.
  static anthropic(
    model: string,
    effort: Effort,
    systemPrompt: string,
    apiKey: string,
    toolSchemas: unknown[],
  ): AnthropicProvider {
    return new AnthropicProvider(
      "Anthropic",
      model,
      effort,
      systemPrompt,
      MESSAGES_ENDPOINT,
      [
        ["x-api-key", apiKey],
        ["anthropic-version", ANTHROPIC_VERSION],
      ],
      toolSchemas,
    );
  }

  async turn(
    fetchFn: typeof fetch,
    history: AgentMessage[],
    emitter: RuntimeEmitter,
    signal: AbortSignal,
  ): Promise<Turn> {
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: 8192,
      system: this.systemPrompt,
      tools: this.toolSchemas,
      messages: messages(history),
    };
    // Map the unified effort onto an extended-thinking budget for models that
    // support it. `max_tokens` scales above the budget (API invariant); an
    // undefined tier (minimal) keeps the fast path with the default
    // max_tokens.
    const thinking = supportsEffort(this.kind, this.model)
      ? anthropicThinkingTier(this.effort)
      : undefined;
    if (thinking) {
      const [budget, maxTokens] = thinking;
      body.max_tokens = maxTokens;
      body.thinking = { type: "enabled", budget_tokens: budget };
    }
    // Stream so text renders token-by-token; `stream` emits `assistant_text`
    // deltas and hands back a reconstructed `{ content: [...] }` response
    // consumed below exactly like a non-streaming POST would be.
    body.stream = true;
    const response = await stream(
      fetchFn,
      this.endpoint,
      this.headers,
      body,
      emitter,
      signal,
    );

    const turn: Turn = {
      texts: [],
      toolCalls: [],
      usage: usageFromValue(response.usage),
    };
    for (const block of response.content) {
      const type = asString(get(block, "type"));
      if (type === "text") {
        const text = asString(get(block, "text"));
        if (text) turn.texts.push(text);
      } else if (type === "tool_use") {
        const id = asString(get(block, "id"));
        const name = asString(get(block, "name"));
        if (id === undefined || name === undefined) continue;
        const input = get(block, "input") ?? {};
        let argumentsJson: string;
        try {
          argumentsJson = JSON.stringify(input);
        } catch {
          argumentsJson = "{}";
        }
        const call: ToolCall = { id, name, arguments: argumentsJson };
        turn.toolCalls.push(call);
      }
    }
    return turn;
  }

  noteToolOutput(): void {}
  noteCompaction(): void {}
  responseId(): string | undefined {
    return undefined;
  }
}

/// Streams a Messages API request, emitting assistant text incrementally as
/// `assistant_text` events, and returns a reconstructed response object with
/// the same `{ content: [...] }` shape a non-streaming POST would — so the
/// agent loop can consume it unchanged (text is NOT re-emitted there).
export async function stream(
  fetchFn: typeof fetch,
  url: string,
  headers: Headers,
  body: unknown,
  emitter: RuntimeEmitter,
  signal: AbortSignal,
): Promise<AssembledMessage> {
  const parser = new SseParser();
  const assembler = new ContentAssembler();
  for await (const chunk of openSse(
    fetchFn,
    url,
    headers,
    body,
    signal,
    undefined,
    emitter,
  )) {
    for (const event of parser.feed(chunk)) {
      const terminal = assembler.onEvent(event, emitter);
      if (terminal) {
        if (terminal.ok) return terminal.response;
        throw terminal.error;
      }
    }
  }
  // Stream ended without an explicit message_stop: return whatever completed.
  return assembler.finish();
}

/// A no-tools round-trip used for compaction: summarize `input` under
/// `instruction` with this model. Streams through a null emitter so nothing
/// reaches the UI. Kimi shares the Anthropic wire dialect, so one builder
/// covers both — the endpoint and headers are the only per-provider data.
/// Returns `{ content: [...] }` for the compaction summary extractor.
export async function summarize(
  fetchFn: typeof fetch,
  endpoint: string,
  headers: Headers,
  model: string,
  instruction: string,
  input: string,
  signal: AbortSignal,
): Promise<{ content: unknown[] }> {
  const body = {
    model,
    max_tokens: 1024,
    system: instruction,
    messages: [{ role: "user", content: input }],
    stream: true,
  };
  const response = await stream(
    fetchFn,
    endpoint,
    headers,
    body,
    nullEmitter,
    signal,
  );
  return { content: asArray(response.content) ?? [] };
}
