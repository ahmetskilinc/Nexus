import type { AgentMessage, RuntimeEmitter } from "@nexus/protocol";
import { asNumber, get, RuntimeError } from "@nexus/protocol";

export const ANTHROPIC_VERSION = "2023-06-01";

/// Total per-request budget, matching the Rust reqwest client's 300s timeout
/// (it covered the whole request including the streamed body).
export const REQUEST_TIMEOUT_MS = 300_000;

export type ProviderKind = "OpenAI" | "Anthropic" | "Kimi";
export type AuthMethod = "api_key" | "oauth";

export function parseProviderKind(value: string): ProviderKind {
  if (value === "OpenAI" || value === "Anthropic" || value === "Kimi")
    return value;
  throw RuntimeError.msg(`Unknown provider kind "${value}".`);
}

export function parseAuthMethod(value: string): AuthMethod {
  if (value === "api_key" || value === "oauth") return value;
  throw RuntimeError.msg(`Unknown authentication method "${value}".`);
}

/// One tool invocation requested by the model. `arguments` is the raw JSON
/// string exactly as the provider sent it.
export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

/// Token usage for one provider round-trip (or a whole run, summed). Input
/// counts include prompt-cache reads/writes — good enough for a meter, not a
/// billing statement.
export type Usage = {
  inputTokens: number;
  outputTokens: number;
};

export function emptyUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0 };
}

export function addUsage(total: Usage, other: Usage): Usage {
  return {
    inputTokens: total.inputTokens + other.inputTokens,
    outputTokens: total.outputTokens + other.outputTokens,
  };
}

/// Reads a `{ "input_tokens": …, "output_tokens": … }` object (absent or
/// malformed fields count as zero).
export function usageFromValue(value: unknown): Usage {
  return {
    inputTokens: asNumber(get(value, "input_tokens")) ?? 0,
    outputTokens: asNumber(get(value, "output_tokens")) ?? 0,
  };
}

/// What one provider round-trip produced. `texts` were already streamed to the
/// UI as deltas during the request; the agent loop records them into history
/// without re-emitting.
export type Turn = {
  texts: string[];
  toolCalls: ToolCall[];
  usage: Usage;
};

export type Headers = [string, string][];

/// The provider seam: everything wire-specific about one conversation —
/// endpoint, headers, body shape, effort key, history folding, SSE dialect,
/// and response-id chaining — behind three methods the agent loop drives.
/// The interface exists so tests can drive the loop with a scripted fake.
export interface Provider {
  /// Build and send one request from the canonical history, streaming
  /// `assistant_text` deltas through the emitter, and return the parsed turn.
  turn(
    fetchFn: typeof fetch,
    history: AgentMessage[],
    emitter: RuntimeEmitter,
    signal: AbortSignal,
  ): Promise<Turn>;

  /// Feed one executed tool result back for the next request. Providers that
  /// rebuild their input from history (Anthropic, the ChatGPT backend)
  /// ignore it.
  noteToolOutput(callId: string, output: string): void;

  /// History was compacted: the next request must rebuild from the canonical
  /// history instead of any server-side chain. No-op for providers that
  /// replay history every turn; the OpenAI API-key backend drops its
  /// `previous_response_id`.
  noteCompaction(): void;

  /// Last response id for server-side session chaining (OpenAI API-key
  /// backend only); surfaced in the run result.
  responseId(): string | undefined;
}

/// GET returning parsed JSON, with the Rust `get_json` 20s timeout and
/// error-body extraction.
export async function getJson(
  fetchFn: typeof fetch,
  url: string,
  headers: Headers,
  signal?: AbortSignal,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(20_000);
  const response = await fetchFn(url, {
    headers: Object.fromEntries(headers),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  }).catch((error: unknown) => {
    throw RuntimeError.msg(
      `The provider request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  const text = await response.text();
  if (!response.ok) throw RuntimeError.http(response.status, text);
  try {
    return JSON.parse(text);
  } catch {
    throw RuntimeError.invalidResponse();
  }
}
