/// Conversation compaction: when the folded history grows large enough to
/// crowd the context window, summarize the oldest turns into a single message
/// and keep only the most recent ones verbatim.
///
/// The threshold is derived from the model's models.dev context limit (falling
/// back to a conservative default when the catalog has no entry). The summary
/// itself is produced by a no-tools provider round-trip; a failure there is
/// non-fatal — the run continues uncompacted and retries later.
import type { AgentMessage } from "@nexus/protocol";
import { asArray, asString, get } from "@nexus/protocol";

/// Rough chars-per-token estimate for folded history. Deliberately cheap (no
/// tokenizer dependency); compaction only needs an order-of-magnitude signal.
const CHARS_PER_TOKEN = 4;

/// Fraction of the context window at which compaction kicks in. Below the
/// window so the summary turn plus the model's own reply still fit.
export const TRIGGER_FRACTION = 0.7;

/// Default assumed context window when the catalog has no limit for the model.
export const DEFAULT_CONTEXT_TOKENS = 200_000;

/// How many recent messages to keep verbatim. Everything older is folded into
/// the summary. The boundary is nudged so it never splits a tool call from its
/// result or lands inside an assistant run.
const KEEP_RECENT = 6;

/// The prompt handed to the summarizer for the older turns.
export const SUMMARY_INSTRUCTION =
  "Summarize this coding-agent conversation so far for the agent continuing it. Capture: the user's goal and any constraints they stated, decisions made, files created/changed (with paths), commands run and their outcomes, and the current state of the work. Be compact (under 400 words), factual, and omit pleasantries. Output only the summary.";

/// The wrapped summary replaces the compacted messages at the head of history.
const SUMMARY_PREFIX =
  "Summary of the conversation so far (older turns were compacted):\n\n";

/// Estimated token size of the folded history.
export function estimateTokens(history: AgentMessage[]): number {
  const chars = history.reduce((sum, message) => sum + messageLen(message), 0);
  return Math.floor(chars / CHARS_PER_TOKEN);
}

/// The trigger threshold (in estimated tokens) for a model with this context
/// window. Undefined falls back to the default window.
export function threshold(contextTokens: number | undefined): number {
  const window = contextTokens ?? DEFAULT_CONTEXT_TOKENS;
  return Math.floor(window * TRIGGER_FRACTION);
}

/// Whether the history is large enough to compact: above the threshold AND
/// long enough that there's something older than the keep-recent tail.
export function shouldCompact(
  history: AgentMessage[],
  contextTokens: number | undefined,
): boolean {
  return (
    history.length > KEEP_RECENT + 2 &&
    estimateTokens(history) >= threshold(contextTokens)
  );
}

/// Renders the older turns into a plain transcript for the summarizer.
export function summaryInput(older: AgentMessage[]): string {
  const lines: string[] = [];
  for (const message of older) {
    switch (message.type) {
      case "user":
        lines.push(`User: ${message.text}`);
        break;
      case "assistant_text":
        lines.push(`Assistant: ${message.text}`);
        break;
      case "tool_call":
        lines.push(`Assistant called ${message.name} ${message.arguments}`);
        break;
      case "tool_result": {
        const trimmed = [...message.output].slice(0, 500).join("");
        lines.push(`${message.name} returned: ${trimmed}`);
        break;
      }
    }
  }
  return lines.join("\n");
}

/// Where to split: the index of the first kept message, nudged forward so the
/// kept tail starts on a `user` message and never inside a tool exchange. This
/// keeps every provider's folded history well-formed (a tool_use always has
/// its tool_result, and a tool_result never opens a turn).
function splitIndex(history: AgentMessage[]): number {
  let index = Math.max(history.length - KEEP_RECENT, 0);
  while (index < history.length && history[index]?.type !== "user") index += 1;
  return index;
}

/// Builds the compacted history: the summary as one leading `user` message
/// followed by the untouched recent tail. Undefined when there is nothing
/// meaningful to compact (the tail would be the whole history).
export function fold(
  history: AgentMessage[],
  summary: string,
): AgentMessage[] | undefined {
  const index = splitIndex(history);
  if (index === 0 || index >= history.length) return undefined;
  return [
    { type: "user", text: `${SUMMARY_PREFIX}${summary}` },
    ...history.slice(index),
  ];
}

/// The messages handed to the summarizer (everything before the keep tail).
/// Undefined when compaction wouldn't actually shrink anything.
export function olderMessages(
  history: AgentMessage[],
): AgentMessage[] | undefined {
  const index = splitIndex(history);
  return index > 0 ? history.slice(0, index) : undefined;
}

function messageLen(message: AgentMessage): number {
  switch (message.type) {
    case "user":
    case "assistant_text":
      return message.text.length;
    case "tool_call":
      return message.name.length + message.arguments.length;
    case "tool_result":
      return message.name.length + message.output.length;
  }
}

/// Extracts the summary text from a provider turn's returned content blocks.
/// Accepts the Anthropic `{ content: [{ type: "text", text }] }` shape; the
/// OpenAI shape is normalized to this by its summarizer before calling.
export function extractSummary(response: unknown): string | undefined {
  const content = asArray(get(response, "content"));
  if (!content) return undefined;
  const text = content
    .filter((block) => asString(get(block, "type")) === "text")
    .flatMap((block) => {
      const value = asString(get(block, "text"));
      return value !== undefined ? [value] : [];
    })
    .join("\n")
    .trim();
  return text.length > 0 ? text : undefined;
}
