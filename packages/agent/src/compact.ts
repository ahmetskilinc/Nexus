/// The one summarize-and-fold routine, shared by the automatic path inside
/// `runLoop` and the user-triggered `agent.compact` request. Keeping both on
/// this function is what guarantees a hand-triggered compaction produces
/// exactly the same history a threshold-triggered one would.
import type { AgentMessage } from "@nexus/protocol";
import { fold, olderMessages, summaryInput } from "./compaction";

/// The one thing compaction needs from a `Summarizer`. Structural rather than
/// the class itself so tests can drive this with a scripted stand-in and so
/// this module doesn't depend on the provider plumbing.
export type Summarize = {
  summarize(
    fetchFn: typeof fetch,
    input: string,
    signal: AbortSignal,
  ): Promise<string>;
};

export type Compaction = {
  /// The folded history: the summary as one leading `user` message followed
  /// by the untouched recent tail.
  messages: AgentMessage[];
  summary: string;
  removedMessages: number;
  keptMessages: number;
};

/// Summarizes the older turns and folds them into one leading message.
/// Undefined when there is nothing worth compacting (the kept tail would be
/// the whole history). Errors from the summarizer round-trip propagate — the
/// automatic caller swallows them, the manual one surfaces them.
export async function compactOnce(options: {
  summarizer: Summarize;
  fetchFn: typeof fetch;
  messages: AgentMessage[];
  signal: AbortSignal;
}): Promise<Compaction | undefined> {
  const older = olderMessages(options.messages);
  if (!older) return undefined;
  const summary = await options.summarizer.summarize(
    options.fetchFn,
    summaryInput(older),
    options.signal,
  );
  const folded = fold(options.messages, summary);
  if (!folded) return undefined;
  return {
    messages: folded,
    summary,
    // The summary message itself replaces the removed ones, so it is not
    // counted as a removal.
    removedMessages: options.messages.length - folded.length + 1,
    keptMessages: folded.length,
  };
}
