/// web_fetch: SSRF-guarded HTTP(S) fetch that follows redirects manually so
/// every hop is re-checked, caps the body, and reduces HTML to text.

import { ToolError } from "@nexus/protocol";
import { htmlToText } from "./html-to-text";
import { guardPublicUrl } from "./ssrf";
import {
  countCodePoints,
  errorMessage,
  OUTPUT_LIMIT,
  takeCodePoints,
} from "./util";

/// Cap on a `web_fetch` response body before extraction, to bound memory.
export const WEB_FETCH_BYTE_LIMIT = 2_000_000;
/// How long a single web request may take before it is abandoned.
export const WEB_TIMEOUT_MS = 20_000;
/// How many redirects `web_fetch` follows; each hop is re-checked for SSRF.
const MAX_REDIRECTS = 5;

/// Combines the caller's signal with a per-request timeout. Returns the
/// composite signal plus a dispose to clear the timer.
export function timedSignal(
  signal: AbortSignal,
  timeoutMs: number,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("the request timed out")),
    timeoutMs,
  );
  const onAbort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    },
  };
}

async function readCappedBody(
  response: Response,
): Promise<{ body: Uint8Array; truncated: boolean }> {
  if (response.body === null)
    return { body: new Uint8Array(), truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    let result: Awaited<ReturnType<typeof reader.read>>;
    try {
      result = await reader.read();
    } catch (error) {
      throw new ToolError(
        `the response could not be read: ${errorMessage(error)}`,
      );
    }
    if (result.done) break;
    const chunk = result.value;
    const remaining = WEB_FETCH_BYTE_LIMIT - total;
    if (chunk.length > remaining) {
      chunks.push(chunk.subarray(0, remaining));
      total += remaining;
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(chunk);
    total += chunk.length;
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return { body, truncated };
}

/// Fetches a URL and returns readable text. Rejects non-HTTP(S) URLs and
/// hosts that resolve to internal addresses (SSRF), follows redirects
/// manually so each hop is re-checked, caps the body, and reduces HTML to
/// text. Model-facing failures are thrown as ToolError.
export async function webFetch(
  url: string,
  signal: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const requested = url;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new ToolError("only http:// and https:// URLs can be fetched.");
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new ToolError("only http:// and https:// URLs can be fetched.");
  }
  let current = parsedUrl.toString();
  let response: Response | null = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    try {
      await guardPublicUrl(current);
    } catch (error) {
      throw new ToolError(`${errorMessage(error)}.`);
    }
    const timed = timedSignal(signal, WEB_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetchFn(current, {
        redirect: "manual",
        headers: { "User-Agent": "NexusAgent/0.1" },
        signal: timed.signal,
      });
    } catch (error) {
      throw new ToolError(`the request failed: ${errorMessage(error)}`);
    } finally {
      timed.dispose();
    }
    if (resp.status < 300 || resp.status > 399) {
      response = resp;
      break;
    }
    // A redirect: resolve the target, re-check it on the next iteration.
    const location = resp.headers.get("location");
    if (location === null) {
      response = resp;
      break;
    }
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      throw new ToolError("the server sent an invalid redirect.");
    }
    if (next.protocol !== "http:" && next.protocol !== "https:") {
      throw new ToolError("refusing to follow a non-HTTP(S) redirect.");
    }
    current = next.toString();
  }
  if (response === null) throw new ToolError("too many redirects.");
  const status = response.status;
  const contentType = response.headers.get("content-type") ?? "";
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > WEB_FETCH_BYTE_LIMIT
  ) {
    throw new ToolError(
      `the response exceeds the ${WEB_FETCH_BYTE_LIMIT} byte limit.`,
    );
  }
  const { body, truncated: truncatedBytes } = await readCappedBody(response);
  const raw = new TextDecoder("utf-8").decode(body);
  const extracted =
    contentType.includes("html") || raw.trimStart().startsWith("<")
      ? htmlToText(raw)
      : raw;
  const textTruncated = countCodePoints(extracted) > OUTPUT_LIMIT;
  const text = takeCodePoints(extracted, OUTPUT_LIMIT);
  const metadata = `Source: ${requested}\nFinal URL: ${current}\nStatus: ${status}\nContent-Type: ${contentType === "" ? "unknown" : contentType}\nTruncated: ${truncatedBytes || textTruncated}`;
  if (status < 200 || status > 299) return `${metadata}\n\n${text}`;
  if (text.trim() === "") {
    return `${metadata}\n\nThe page returned no readable text.`;
  }
  return `${metadata}\n\n${text}`;
}
