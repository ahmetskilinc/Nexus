import { RuntimeError } from "@nexus/protocol";
import type { Headers } from "./types";
import { REQUEST_TIMEOUT_MS } from "./types";

/// Upper bound on the unterminated tail held between chunks. A well-behaved
/// provider emits newline-delimited `data:` lines far shorter than this; the
/// cap only defends against one that streams without newlines and would
/// otherwise grow the buffer without limit.
const MAX_BUFFER = 4 * 1024 * 1024;

/// Incremental SSE `data:` line parser. Feed raw byte chunks as they arrive;
/// get back the parsed JSON payloads of every complete `data:` line. Handles
/// chunk boundaries falling mid-line, CRLF, `data:`/`data: ` prefixes, and
/// skips `[DONE]` markers, comments, non-`data:` fields, and unparseable
/// payloads.
export class SseParser {
  private buffer = "";
  private decoder = new TextDecoder();

  feed(chunk: Uint8Array | string): unknown[] {
    this.buffer +=
      typeof chunk === "string"
        ? chunk
        : this.decoder.decode(chunk, { stream: true });
    const events: unknown[] = [];
    let newline = this.buffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).replace(/\r+$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf("\n");
      if (!line.startsWith("data:")) continue;
      const payload = line.slice("data:".length).trim();
      if (payload === "[DONE]") continue;
      try {
        events.push(JSON.parse(payload));
      } catch {
        // Unparseable payloads are skipped, same as the Rust parser.
      }
    }
    // Only an unterminated tail remains here (no newline). If it has grown
    // past the cap, the provider is streaming a pathologically long line;
    // drop it to bound memory — the stream resyncs at the next newline.
    if (this.buffer.length > MAX_BUFFER) this.buffer = "";
    return events;
  }
}

/// POSTs an SSE request and yields raw byte chunks once the status is known
/// good (a non-2xx body is drained into RuntimeError.http). Callers drive an
/// SseParser over the chunks. The overall request (including the streamed
/// body) is bounded by the 300s budget, matching the Rust client timeout.
export async function* openSse(
  fetchFn: typeof fetch,
  url: string,
  headers: Headers,
  body: unknown,
  signal: AbortSignal,
  timeoutMs = REQUEST_TIMEOUT_MS,
): AsyncGenerator<Uint8Array, void, void> {
  const combined = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      ...Object.fromEntries(headers),
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    signal: combined,
  }).catch((error: unknown) => {
    if (signal.aborted || combined.aborted) throw error;
    throw RuntimeError.msg(
      `The provider request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw RuntimeError.http(response.status, text);
  }
  if (!response.body) return;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
    await response.body.cancel().catch(() => {});
  }
}
