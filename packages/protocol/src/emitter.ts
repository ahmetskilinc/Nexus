import type { RuntimeEvent } from "./events";

/// The runtime-internal event sink a run emits through. Implementations MUST
/// deliver synchronously (no awaiting between compose and send) so event order
/// matches emission order under concurrent runs.
export interface RuntimeEmitter {
  emit(event: RuntimeEvent): void;
}

/// Swallows events. Used where the Rust runtime passed a null emitter: the
/// compaction summarizer's provider turns and sub-agent inner streaming.
export const nullEmitter: RuntimeEmitter = { emit: () => {} };

/// An emitter that collects events into an array — the standard test double.
export function collectingEmitter(): RuntimeEmitter & {
  events: RuntimeEvent[];
} {
  const events: RuntimeEvent[] = [];
  return { events, emit: (event) => events.push(event) };
}
