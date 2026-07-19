import type {
  HostMessage,
  HostRequest,
  HostResponse,
  InitMessage,
  RuntimeEvent,
} from "@nexus/protocol";
import { parseRuntimeEvent } from "@nexus/protocol";

type Pending = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (reason: Error) => void;
  onEvent?: (event: RuntimeEvent) => void;
};

/// The slice of Electron's UtilityProcess the client uses — injected so unit
/// tests can drive the client with a fake child and this module never has to
/// import electron.
export type RuntimeChild = {
  postMessage(message: HostMessage): void;
  on(event: "message", listener: (message: unknown) => void): void;
  on(event: "exit", listener: (code: number) => void): void;
  kill(): boolean;
};

export type RuntimeClientOptions = {
  /// Forks the runtime utilityProcess (dist/runtime/index.js). Called lazily
  /// on first request and again after a crash.
  fork: () => RuntimeChild;
  /// Fallback runtime factory used when the utilityProcess never completes
  /// its ready handshake (e.g. Chromium's Mach rendezvous validation breaking
  /// utility processes in signed builds). Once engaged it stays engaged for
  /// the life of the client.
  forkFallback?: () => RuntimeChild;
  /// Init payload for a freshly forked runtime.
  init: () => InitMessage["config"];
  /// Services the runtime's reverse-direction requests (safeStorage bridge).
  onHostRequest: (request: HostRequest) => Promise<HostResponse>;
  readyTimeoutMs?: number;
};

/// Typed client for the runtime utilityProcess. Same outward shape as the old
/// NDJSON RuntimeManager: `request()` returns `{id, response}` synchronously
/// (call sites close over the id before any message can arrive), a dead child
/// fails all in-flight requests and respawns on the next request.
export class RuntimeClient {
  private child?: RuntimeChild;
  private ready = false;
  private queue: HostMessage[] = [];
  private pending = new Map<string, Pending>();
  private nextId = 0;
  private readyTimer?: ReturnType<typeof setTimeout>;
  private usingFallback = false;

  constructor(private options: RuntimeClientOptions) {}

  request(
    method: string,
    params: Record<string, unknown> = {},
    onEvent?: (event: RuntimeEvent) => void,
  ): { id: string; response: Promise<Record<string, unknown>> } {
    const id = `${Date.now()}-${++this.nextId}`;
    this.ensureRunning();
    const response = new Promise<Record<string, unknown>>((resolve, reject) =>
      this.pending.set(id, { resolve, reject, onEvent }),
    );
    this.send({ kind: "request", id, method, params });
    return { id, response };
  }

  async cancel(runId: string) {
    await this.request("cancel", { runId }).response;
  }

  dispose() {
    this.child?.kill();
    this.child = undefined;
  }

  private send(message: HostMessage) {
    if (this.ready) this.child?.postMessage(message);
    else this.queue.push(message);
  }

  private ensureRunning() {
    if (this.child) return;
    this.spawn(
      this.usingFallback && this.options.forkFallback
        ? this.options.forkFallback
        : this.options.fork,
    );
  }

  private spawn(factory: () => RuntimeChild) {
    const child = factory();
    this.child = child;
    this.ready = false;
    child.on("message", (message) => this.handleMessage(child, message));
    child.on("exit", () => {
      if (this.child === child) this.handleExit();
    });
    child.postMessage({ kind: "init", config: this.options.init() });
    this.readyTimer = setTimeout(() => {
      if (this.ready || this.child !== child) return;
      child.kill();
      this.child = undefined;
      // A runtime that never says ready is stuck at the transport layer, not
      // failed — retry once on the in-process fallback before giving up. The
      // queued requests (and their pending promises) carry over untouched.
      if (!this.usingFallback && this.options.forkFallback) {
        this.usingFallback = true;
        console.error(
          "RuntimeClient: utilityProcess never completed its handshake; " +
            "falling back to the in-process runtime.",
        );
        this.spawn(this.options.forkFallback);
        return;
      }
      this.queue = [];
      this.failAll(new Error("The Nexus runtime did not start."));
    }, this.options.readyTimeoutMs ?? 10_000);
  }

  private handleMessage(child: RuntimeChild, raw: unknown) {
    if (typeof raw !== "object" || raw === null) return;
    const message = raw as { kind?: unknown };
    switch (message.kind) {
      case "ready": {
        this.ready = true;
        clearTimeout(this.readyTimer);
        const queued = this.queue;
        this.queue = [];
        for (const item of queued) child.postMessage(item);
        return;
      }
      case "response": {
        const { id, ok } = message as { id: string; ok: boolean };
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        if (ok) {
          const { result } = message as { result?: unknown };
          pending.resolve(
            typeof result === "object" && result !== null
              ? (result as Record<string, unknown>)
              : {},
          );
        } else {
          const { error } = message as {
            error?: { message?: string; cancelled?: boolean };
          };
          pending.reject(
            Object.assign(
              new Error(error?.message ?? "Runtime request failed."),
              { cancelled: error?.cancelled },
            ),
          );
        }
        return;
      }
      case "event": {
        const { id, event } = message as { id: string; event: unknown };
        // Re-validate at the process boundary; drop anything malformed.
        const parsed = parseRuntimeEvent(event);
        if (parsed) this.pending.get(id)?.onEvent?.(parsed);
        return;
      }
      case "host-request": {
        const request = message as HostRequest;
        void this.options
          .onHostRequest(request)
          .catch(
            (error: Error): HostResponse => ({
              kind: "host-response",
              id: request.id,
              ok: false,
              error: error.message,
            }),
          )
          .then((response) => {
            if (this.child === child) child.postMessage(response);
          });
        return;
      }
      default:
        return;
    }
  }

  private handleExit() {
    clearTimeout(this.readyTimer);
    this.child = undefined;
    this.ready = false;
    this.queue = [];
    this.failAll(new Error("The Nexus runtime stopped unexpectedly."));
  }

  private failAll(error: Error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
