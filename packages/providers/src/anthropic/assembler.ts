import type { RuntimeEmitter } from "@nexus/protocol";
import { asNumber, asString, get, RuntimeError } from "@nexus/protocol";
import type { Usage } from "../types";
import { emptyUsage } from "../types";

/// A content block being assembled from the SSE stream. Text blocks accumulate
/// their string; tool_use blocks accumulate their input JSON as it arrives in
/// `input_json_delta` fragments (Anthropic sends the input as a partial-JSON
/// string, not object deltas). Thinking/redacted blocks are tracked but not
/// surfaced.
type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; json: string }
  | { type: "other" };

function finishBlock(block: Block): unknown | undefined {
  if (block.type === "text" && block.text.length > 0)
    return { type: "text", text: block.text };
  if (block.type === "tool_use") {
    let input: unknown;
    try {
      input = JSON.parse(block.json);
    } catch {
      input = {};
    }
    return { type: "tool_use", id: block.id, name: block.name, input };
  }
  return undefined;
}

/// The reconstructed non-streaming response shape a terminal event yields.
export type AssembledMessage = {
  content: unknown[];
  usage: { input_tokens: number; output_tokens: number };
};

export type Terminal =
  | { ok: true; response: AssembledMessage }
  | { ok: false; error: RuntimeError };

/// Pure reducer over Messages API stream events. Blocks arrive in order, keyed
/// by `index`; content_block_start opens one and content_block_stop finalizes
/// it. Blocks stay indexed so out-of-order stops (rare) still land right.
export class ContentAssembler {
  private blocks: (Block | undefined)[] = [];
  private content: unknown[] = [];
  private usage: Usage = emptyUsage();

  /// Applies one stream event; returns a Terminal when the stream is done
  /// (message_stop or a mid-stream error).
  onEvent(event: unknown, emitter: RuntimeEmitter): Terminal | undefined {
    switch (asString(get(event, "type"))) {
      case "message_start": {
        // Input tokens (incl. prompt-cache reads/writes) arrive once, up
        // front; the initial output count is superseded by message_delta but
        // seeds the total for tiny responses.
        const usage = get(event, "message", "usage");
        this.usage.inputTokens =
          (asNumber(get(usage, "input_tokens")) ?? 0) +
          (asNumber(get(usage, "cache_read_input_tokens")) ?? 0) +
          (asNumber(get(usage, "cache_creation_input_tokens")) ?? 0);
        this.usage.outputTokens = asNumber(get(usage, "output_tokens")) ?? 0;
        return undefined;
      }
      case "message_delta": {
        // Cumulative, not incremental — overwrite with the latest.
        const output = asNumber(get(event, "usage", "output_tokens"));
        if (output !== undefined) this.usage.outputTokens = output;
        return undefined;
      }
      case "content_block_start": {
        const index = asNumber(get(event, "index")) ?? 0;
        const kind = asString(get(event, "content_block", "type"));
        const block: Block =
          kind === "text"
            ? { type: "text", text: "" }
            : kind === "tool_use"
              ? {
                  type: "tool_use",
                  id: asString(get(event, "content_block", "id")) ?? "",
                  name: asString(get(event, "content_block", "name")) ?? "",
                  json: "",
                }
              : { type: "other" };
        this.blocks[index] = block;
        return undefined;
      }
      case "content_block_delta": {
        const index = asNumber(get(event, "index")) ?? 0;
        const block = this.blocks[index];
        if (!block) return undefined;
        const deltaType = asString(get(event, "delta", "type"));
        if (deltaType === "text_delta" && block.type === "text") {
          const fragment = asString(get(event, "delta", "text"));
          if (fragment !== undefined) {
            block.text += fragment;
            if (fragment.length > 0)
              emitter.emit({ type: "assistant_text", text: fragment });
          }
        } else if (
          deltaType === "input_json_delta" &&
          block.type === "tool_use"
        ) {
          const fragment = asString(get(event, "delta", "partial_json"));
          if (fragment !== undefined) block.json += fragment;
        }
        return undefined;
      }
      case "content_block_stop": {
        const index = asNumber(get(event, "index")) ?? 0;
        const block = this.blocks[index];
        this.blocks[index] = undefined;
        if (block) {
          const finished = finishBlock(block);
          if (finished !== undefined) this.content.push(finished);
        }
        return undefined;
      }
      case "message_stop": {
        const response = this.snapshot();
        this.content = [];
        return { ok: true, response };
      }
      case "error": {
        // The HTTP status is 200 by now — the failure arrived mid-stream — so
        // surface only the provider's message.
        const message =
          asString(get(event, "error", "message")) ??
          "The provider reported a stream error.";
        return { ok: false, error: RuntimeError.msg(message) };
      }
      default:
        return undefined;
    }
  }

  /// The fallback response when the stream ends without message_stop.
  finish(): AssembledMessage {
    return this.snapshot();
  }

  private snapshot(): AssembledMessage {
    return {
      content: [...this.content],
      usage: {
        input_tokens: this.usage.inputTokens,
        output_tokens: this.usage.outputTokens,
      },
    };
  }
}
