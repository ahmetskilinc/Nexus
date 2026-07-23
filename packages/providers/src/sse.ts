import { RuntimeError, type RuntimeEmitter } from "@nexus/protocol";
import type { Headers } from "./types";
import { REQUEST_TIMEOUT_MS } from "./types";

/// Upper bound on the unterminated tail held between chunks. A well-behaved
/// provider emits newline-delimited `data:` lines far shorter than this; the
/// cap only defends against one that streams without newlines and would
/// otherwise grow the buffer without limit.
const MAX_BUFFER = 4 * 1024 * 1024;
const MAX_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 500;

function retryDelayMs(attempt: number, retryAfter: string | null): number {
  // Providers may return either seconds or an HTTP date. Honor a reasonable
  // Retry-After value when supplied; otherwise use bounded exponential backoff.
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0)
      return Math.min(seconds * 1000, 10_000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date))
      return Math.min(Math.max(0, date - Date.now()), 10_000);
  }
  return BASE_RETRY_DELAY_MS * 2 ** attempt;
}

async function waitForRetry(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, delayMs);
    const abort = () => {
      clearTimeout(timeout);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

function isRetryableStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

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
  emitter?: RuntimeEmitter,
): AsyncGenerator<Uint8Array, void, void> {
  let response: Response | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const combined = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
    try {
      response = await fetchFn(url, {
        method: "POST",
        headers: {
          ...Object.fromEntries(headers),
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch (error) {
      if (signal.aborted) throw error;
      if (attempt === MAX_RETRIES || combined.aborted)
        throw RuntimeError.msg(
          `The provider request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      const delayMs = retryDelayMs(attempt, null);
      emitter?.emit({
        type: "provider_retry",
        attempt: attempt + 1,
        delayMs,
        reason: "Network request failed",
      });
      await waitForRetry(delayMs, signal);
      continue;
    }
    if (response.ok) break;
    const text = await response.text().catch(() => "");
    if (attempt === MAX_RETRIES || !isRetryableStatus(response.status))
      throw RuntimeError.http(response.status, text);
    const delayMs = retryDelayMs(attempt, response.headers.get("retry-after"));
    emitter?.emit({
      type: "provider_retry",
      attempt: attempt + 1,
      delayMs,
      reason: `Provider temporarily unavailable (HTTP ${response.status})`,
    });
    await waitForRetry(delayMs, signal);
    response = undefined;
  }
  if (!response)
    throw RuntimeError.msg("The provider request failed after retrying.");
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
