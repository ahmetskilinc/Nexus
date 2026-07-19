import type { RuntimeEmitter } from "@nexus/protocol";
import {
  asArray,
  asRecord,
  asString,
  get,
  RuntimeError,
} from "@nexus/protocol";

export type Terminal =
  | { ok: true; response: Record<string, unknown> }
  | { ok: false; error: RuntimeError };

/// Pure reducer over Responses API stream events. Collects the
/// `response.output_item.done` items so the ChatGPT backend's empty final
/// `output` array can be backfilled.
export class ResponseAssembler {
  private streamedItems: unknown[] = [];

  /// Applies one stream event; returns a Terminal when the stream is done
  /// (response.completed, response.failed, or a stream error).
  onEvent(event: unknown, emitter: RuntimeEmitter): Terminal | undefined {
    switch (asString(get(event, "type"))) {
      case "response.output_text.delta": {
        const delta = asString(get(event, "delta"));
        if (delta) emitter.emit({ type: "assistant_text", text: delta });
        return undefined;
      }
      case "response.output_item.done": {
        const item = asRecord(get(event, "item"));
        if (item) this.streamedItems.push(item);
        return undefined;
      }
      case "response.completed": {
        const completed = asRecord(get(event, "response"));
        if (!completed)
          return { ok: false, error: RuntimeError.invalidResponse() };
        const response = { ...completed };
        const output = asArray(response.output);
        if (!output || output.length === 0) {
          response.output = this.streamedItems;
          this.streamedItems = [];
        }
        return { ok: true, response };
      }
      case "response.failed": {
        // The HTTP status is 200 by now — the failure arrived mid-stream — so
        // surface only the provider's message.
        const message =
          asString(get(event, "response", "error", "message")) ??
          "The provider reported a failure.";
        return { ok: false, error: RuntimeError.msg(message) };
      }
      case "error": {
        const message =
          asString(get(event, "message")) ??
          "The provider reported a stream error.";
        return { ok: false, error: RuntimeError.msg(message) };
      }
      default:
        return undefined;
    }
  }
}
