import type {
  AgentMessage,
  Effort,
  EphemeralImage,
  RuntimeEmitter,
} from "@nexus/protocol";
import {
  asArray,
  asString,
  get,
  nullEmitter,
  RuntimeError,
} from "@nexus/protocol";
import { openaiEffortValue, supportsEffort } from "../capabilities";
import { openSse, SseParser } from "../sse";
import type { Headers, Provider, ToolCall, Turn } from "../types";
import { usageFromValue } from "../types";
import { ResponseAssembler } from "./assembler";
import { input } from "./input";

export const API_ENDPOINT = "https://api.openai.com/v1/responses";
export const CHATGPT_ENDPOINT =
  "https://chatgpt.com/backend-api/codex/responses";

/// Which OpenAI backend a run talks to. The differences are data, not code:
/// endpoint, headers, and whether responses chain server-side. The ChatGPT
/// backend is SSE-only, requires store:false, and therefore cannot chain with
/// previous_response_id — the full history is replayed.
export type Backend =
  | { kind: "api-key"; apiKey: string }
  | { kind: "chatgpt"; accessToken: string; accountId?: string };

/// The OpenAI Responses API adapter, covering both backends. Wire-level turn
/// state lives here: the API-key backend chains on `previousId` and
/// accumulates `function_call_output` items; the ChatGPT backend re-folds the
/// canonical history every turn.
export class OpenAiProvider implements Provider {
  private endpoint: string;
  private headers: Headers;
  private chatgptBackend: boolean;
  private previousId: string | undefined;
  /// The next request's input: seeded in the constructor from the chaining
  /// state, then refilled with `function_call_output` items via
  /// `noteToolOutput` (API-key backend only).
  private pendingInput: unknown[];
  private firstTurn = true;
  /// Set by `noteCompaction`: the next API-key-backend turn must rebuild its
  /// input from the canonical history (the chain was dropped), then clear.
  private rebuildInput = false;

  constructor(
    private model: string,
    private effort: Effort,
    private systemPrompt: string,
    backend: Backend,
    previousResponseId: string | undefined,
    history: AgentMessage[],
    private toolSchemas: unknown[],
    images: EphemeralImage[] = [],
  ) {
    if (backend.kind === "api-key") {
      this.endpoint = API_ENDPOINT;
      this.headers = [["Authorization", `Bearer ${backend.apiKey}`]];
      this.chatgptBackend = false;
      this.previousId = previousResponseId;
    } else {
      this.endpoint = CHATGPT_ENDPOINT;
      this.headers = [
        ["Authorization", `Bearer ${backend.accessToken}`],
        ["OpenAI-Beta", "responses=experimental"],
        ["originator", "codex_cli_rs"],
        ["session_id", crypto.randomUUID()],
      ];
      if (backend.accountId)
        this.headers.push(["chatgpt-account-id", backend.accountId]);
      this.chatgptBackend = true;
      this.previousId = undefined;
    }
    // With a stored previous response, the server already has the session
    // context; only the latest user message is new input. Otherwise replay
    // the whole history.
    const last = history[history.length - 1];
    if (this.previousId !== undefined && last?.type === "user") {
      this.pendingInput = input([last], images);
    } else {
      this.previousId = undefined;
      this.pendingInput = input(history, images);
    }
  }

  async turn(
    fetchFn: typeof fetch,
    history: AgentMessage[],
    emitter: RuntimeEmitter,
    signal: AbortSignal,
  ): Promise<Turn> {
    // The ChatGPT backend replays the full history (including this run's tool
    // calls and results) on every follow-up request. After compaction the
    // API-key backend does the same once, having dropped its chain.
    let requestInput: unknown[];
    if ((this.chatgptBackend && !this.firstTurn) || this.rebuildInput) {
      this.rebuildInput = false;
      requestInput = input(history);
    } else {
      requestInput = this.pendingInput;
      this.pendingInput = [];
    }
    this.firstTurn = false;

    const body: Record<string, unknown> = {
      model: this.model,
      instructions: this.systemPrompt,
      tools: this.toolSchemas,
      input: requestInput,
    };
    if (this.previousId !== undefined)
      body.previous_response_id = this.previousId;
    // Reasoning models accept `reasoning.effort`; non-reasoning models reject
    // it outright, so gate on the capability check (which also clamps values
    // the specific model family does not accept).
    if (supportsEffort("OpenAI", this.model))
      body.reasoning = { effort: openaiEffortValue(this.model, this.effort) };
    // Both backends stream: text is emitted incrementally inside postSse as
    // `assistant_text` deltas. The API-key backend (store defaults true)
    // still returns the response id for server-side chaining; the ChatGPT
    // backend uses store:false and replays history instead.
    body.stream = true;
    if (this.chatgptBackend) body.store = false;
    const response = await postSse(
      fetchFn,
      this.endpoint,
      this.headers,
      body,
      emitter,
      signal,
    );
    if (!this.chatgptBackend) this.previousId = asString(response.id);

    const turn: Turn = {
      texts: [],
      toolCalls: [],
      // The Responses API reports usage on the final response object, which
      // the assembler returns whole.
      usage: usageFromValue(response.usage),
    };
    for (const item of asArray(response.output) ?? []) {
      const type = asString(get(item, "type"));
      if (type === "message") {
        const text = (asArray(get(item, "content")) ?? [])
          .filter((part) => asString(get(part, "type")) === "output_text")
          .flatMap((part) => {
            const value = asString(get(part, "text"));
            return value !== undefined ? [value] : [];
          })
          .join("\n");
        if (text.length > 0) turn.texts.push(text);
      } else if (type === "function_call") {
        const callId = asString(get(item, "call_id"));
        const name = asString(get(item, "name"));
        if (callId === undefined || name === undefined) continue;
        const call: ToolCall = {
          id: callId,
          name,
          arguments: asString(get(item, "arguments")) ?? "{}",
        };
        turn.toolCalls.push(call);
      }
    }
    return turn;
  }

  noteToolOutput(callId: string, output: string): void {
    if (!this.chatgptBackend)
      this.pendingInput.push({
        type: "function_call_output",
        call_id: callId,
        output,
      });
  }

  /// Compaction replaced the history with a folded version, so the stored
  /// response-id chain no longer corresponds to it. Drop the chain and flag
  /// the next turn to rebuild its input from the canonical history.
  noteCompaction(): void {
    if (!this.chatgptBackend) {
      this.previousId = undefined;
      this.rebuildInput = true;
    }
  }

  responseId(): string | undefined {
    return this.previousId;
  }
}

/// Streams a Responses API request and returns the final response object from
/// the `response.completed` event, so the agent loop can treat it like a plain
/// POST. Assistant text is emitted incrementally as `assistant_text` events
/// off each `response.output_text.delta`.
export async function postSse(
  fetchFn: typeof fetch,
  url: string,
  headers: Headers,
  body: unknown,
  emitter: RuntimeEmitter,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const parser = new SseParser();
  const assembler = new ResponseAssembler();
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
  // The stream must end with response.completed/failed; anything else is a
  // protocol violation.
  throw RuntimeError.invalidResponse();
}

/// A no-tools round-trip used for compaction: summarize `input` under
/// `instruction`. Streams through a null emitter so nothing reaches the UI,
/// and never chains server-side, so it works on both backends. Returns
/// Anthropic-shaped `{ content: [...] }` so the compaction summary extractor
/// can read either provider's output.
export async function summarize(
  fetchFn: typeof fetch,
  endpoint: string,
  headers: Headers,
  model: string,
  chatgptBackend: boolean,
  instruction: string,
  inputText: string,
  signal: AbortSignal,
): Promise<{ content: unknown[] }> {
  const body: Record<string, unknown> = {
    model,
    instructions: instruction,
    input: [{ role: "user", content: inputText }],
    stream: true,
  };
  if (chatgptBackend) body.store = false;
  const response = await postSse(
    fetchFn,
    endpoint,
    headers,
    body,
    nullEmitter,
    signal,
  );
  // Normalize the Responses API output into Anthropic's content-block shape.
  let text = "";
  for (const item of asArray(response.output) ?? []) {
    if (asString(get(item, "type")) !== "message") continue;
    const part = (asArray(get(item, "content")) ?? [])
      .filter((entry) => asString(get(entry, "type")) === "output_text")
      .flatMap((entry) => {
        const value = asString(get(entry, "text"));
        return value !== undefined ? [value] : [];
      })
      .join("\n");
    if (part.length > 0) {
      if (text.length > 0) text += "\n";
      text += part;
    }
  }
  return { content: [{ type: "text", text }] };
}
