/// web_search: DuckDuckGo's keyless HTML endpoint, parsed into a ranked
/// result list. Best-effort: the endpoint is unofficial and may change.

import { ToolError } from "@nexus/protocol";
import { htmlToText } from "./html-to-text";
import { errorMessage, percentDecode } from "./util";
import { timedSignal, WEB_FETCH_BYTE_LIMIT, WEB_TIMEOUT_MS } from "./web-fetch";

/// DuckDuckGo wraps outbound links as `//duckduckgo.com/l/?uddg=<encoded>`.
/// Pull the real target out when present; otherwise normalise the scheme.
function decodeDuckDuckGoUrl(raw: string): string {
  const start = raw.indexOf("uddg=");
  if (start !== -1) {
    let encoded = raw.slice(start + 5);
    const end = encoded.indexOf("&");
    if (end !== -1) encoded = encoded.slice(0, end);
    return percentDecode(encoded);
  }
  if (raw.startsWith("//")) return `https:${raw}`;
  return raw;
}

/// Extracts result blocks (title, URL, snippet) from DuckDuckGo HTML output.
export function parseDuckDuckGo(html: string): string[] {
  // The HTML endpoint wraps each result title in `<a class="result__a"
  // href=...>` and the snippet in `<a class="result__snippet">`.
  const link = /result__a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gs;
  const snippetPattern = /result__snippet[^>]*>(.*?)<\/a>/gs;
  const snippets: string[] = [];
  for (const capture of html.matchAll(snippetPattern)) {
    snippets.push(htmlToText(capture[1]).trim());
  }
  const results: string[] = [];
  for (const capture of html.matchAll(link)) {
    if (results.length >= 8) break;
    const index = results.length;
    const url = decodeDuckDuckGoUrl(capture[1]);
    const title = htmlToText(capture[2]).trim();
    const snippet = snippets[index] ?? "";
    results.push(
      snippet === ""
        ? `${index + 1}. ${title}\n${url}`
        : `${index + 1}. ${title}\n${url}\n${snippet}`,
    );
  }
  return results;
}

/// Searches the web via DuckDuckGo and returns a ranked list of results.
export async function webSearch(
  query: string,
  signal: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  if (query.trim() === "") throw new ToolError('"query" is required.');
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);
  // A standard redirect-following request: the endpoint is a fixed, trusted
  // host (no SSRF surface), and DuckDuckGo may redirect the query.
  const timed = timedSignal(signal, WEB_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchFn(url.toString(), {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NexusAgent/0.1)" },
      signal: timed.signal,
    });
  } catch (error) {
    throw new ToolError(`the search request failed: ${errorMessage(error)}`);
  } finally {
    timed.dispose();
  }
  if (response.status < 200 || response.status > 299) {
    throw new ToolError(`search returned HTTP ${response.status}.`);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > WEB_FETCH_BYTE_LIMIT
  ) {
    throw new ToolError("the search response was too large.");
  }
  let html: string;
  try {
    html = await response.text();
  } catch (error) {
    throw new ToolError(
      `the search response could not be read: ${errorMessage(error)}`,
    );
  }
  const results = parseDuckDuckGo(html);
  return results.length === 0 ? "No results found." : results.join("\n\n");
}
