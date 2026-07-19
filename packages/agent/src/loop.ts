import type { AgentMessage } from "@nexus/protocol";
import { RuntimeError } from "@nexus/protocol";
import {
  addUsage,
  anthropicSummarize,
  emptyUsage,
  type Headers,
  openaiSummarize,
  type Provider,
  type ProviderKind,
  type Usage,
} from "@nexus/providers";
import type { CheckpointMetadata, CheckpointRecorder } from "@nexus/workspace";
import type { ApprovalMailbox } from "./approvals";
import {
  extractSummary,
  fold,
  olderMessages,
  SUMMARY_INSTRUCTION,
  shouldCompact,
  summaryInput,
} from "./compaction";
import type { ToolRunner } from "./tool-runner";

export type RunResult = {
  messages: AgentMessage[];
  /// The last OpenAI Responses API response id, used to continue a session
  /// server-side. Undefined for Anthropic.
  openaiResponseId: string | undefined;
  /// Token usage summed across every provider round-trip in the run.
  usage: Usage;
  checkpoint: CheckpointMetadata | null;
};

/// Everything needed to run a no-tools summarization turn for compaction:
/// the model plus the endpoint and auth headers of the provider that owns
/// the run. Carried alongside the live provider so `runLoop` can compact
/// without knowing which backend it's talking to.
export class Summarizer {
  constructor(
    private options: {
      kind: ProviderKind;
      model: string;
      endpoint: string;
      headers: Headers;
      /// OpenAI-only: the ChatGPT backend needs store:false; ignored by the
      /// Anthropic-dialect providers.
      chatgptBackend: boolean;
    },
  ) {}

  /// Summarize `input` under the compaction instruction. Never chains
  /// server-side, so it is safe to call after the response-id chain has been
  /// dropped. Streams through a null emitter — nothing reaches the UI.
  async summarize(
    fetchFn: typeof fetch,
    input: string,
    signal: AbortSignal,
  ): Promise<string> {
    const { kind, model, endpoint, headers, chatgptBackend } = this.options;
    const response =
      kind === "OpenAI"
        ? await openaiSummarize(
            fetchFn,
            endpoint,
            headers,
            model,
            chatgptBackend,
            SUMMARY_INSTRUCTION,
            input,
            signal,
          )
        : await anthropicSummarize(
            fetchFn,
            endpoint,
            headers,
            model,
            SUMMARY_INSTRUCTION,
            input,
            signal,
          );
    const summary = extractSummary(response);
    if (summary === undefined)
      throw RuntimeError.msg("The compaction summary came back empty.");
    return summary;
  }
}

/// The single provider-agnostic agent loop: ask the provider for a turn,
/// record its text, run its tool calls, feed the outputs back, and repeat
/// until a turn requests no tools (done). The loop is unbounded — it runs as
/// many rounds as the task needs; the user can stop a run at any time via
/// `cancel`.
///
/// Before each turn the history is compacted when it grows large enough to
/// crowd the context window: the oldest turns are summarized (via the
/// summarizer, a no-tools round-trip) into one leading message and the recent
/// tail is kept verbatim. A failed or empty summary is non-fatal — the run
/// continues uncompacted.
export async function runLoop(options: {
  provider: Provider;
  runner: ToolRunner;
  checkpoint: CheckpointRecorder;
  mailbox: ApprovalMailbox;
  messages: AgentMessage[];
  summarizer: Summarizer;
  fetchFn: typeof fetch;
  contextTokens: number | undefined;
  maxToolRounds: number;
  maxRunSeconds: number;
  maxRunCostUsd: number | undefined;
  /// Catalog pricing (USD per million tokens) for the cost budget; undefined
  /// skips the check.
  pricing?: { input?: number; output?: number };
}): Promise<RunResult> {
  const { provider, runner, checkpoint, mailbox, summarizer } = options;
  let messages = options.messages;
  let usage = emptyUsage();
  const started = Date.now();
  let toolRounds = 0;
  while (true) {
    if (runner.signal.aborted) throw RuntimeError.msg("The run was cancelled.");
    if (Date.now() - started >= options.maxRunSeconds * 1000) {
      throw RuntimeError.msg(
        `The run reached its ${options.maxRunSeconds}-second time budget.`,
      );
    }
    if (shouldCompact(messages, options.contextTokens)) {
      const older = olderMessages(messages);
      if (older) {
        try {
          const summary = await summarizer.summarize(
            options.fetchFn,
            summaryInput(older),
            runner.signal,
          );
          const folded = fold(messages, summary);
          if (folded) {
            const removed = messages.length - folded.length + 1;
            messages = folded;
            // The OpenAI response-id chain no longer matches the folded
            // history; restart it from the rebuilt input on the next turn.
            provider.noteCompaction();
            runner.emitter.emit({
              type: "compacted",
              removedMessages: removed,
              keptMessages: messages.length,
              summary,
            });
          }
        } catch {
          // Non-fatal: continue uncompacted and retry later.
        }
      }
    }
    const turn = await provider.turn(
      options.fetchFn,
      messages,
      runner.emitter,
      runner.signal,
    );
    usage = addUsage(usage, turn.usage);
    const { pricing } = options;
    if (
      options.maxRunCostUsd !== undefined &&
      pricing?.input !== undefined &&
      pricing.output !== undefined
    ) {
      const estimate =
        (usage.inputTokens / 1e6) * pricing.input +
        (usage.outputTokens / 1e6) * pricing.output;
      if (estimate > options.maxRunCostUsd) {
        throw RuntimeError.msg(
          `The run reached its $${options.maxRunCostUsd.toFixed(2)} estimated cost budget.`,
        );
      }
    }
    // Already streamed to the UI as deltas; only record it in history so
    // the whole blob isn't emitted a second time.
    for (const text of turn.texts)
      messages.push({ type: "assistant_text", text });
    if (turn.toolCalls.length === 0) {
      return {
        messages,
        openaiResponseId: provider.responseId(),
        usage,
        checkpoint: checkpoint.metadata(),
      };
    }
    toolRounds += 1;
    if (toolRounds > options.maxToolRounds) {
      throw RuntimeError.msg(
        `The run reached its ${options.maxToolRounds}-round tool budget. Continue in a new message if more work is needed.`,
      );
    }
    for (const call of turn.toolCalls) {
      const output = await runner.execute(messages, checkpoint, mailbox, call);
      provider.noteToolOutput(call.id, output);
    }
  }
}
