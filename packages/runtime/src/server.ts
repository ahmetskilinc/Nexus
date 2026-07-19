import type {
  HostMessage,
  RuntimeEvent,
  RuntimeMessage,
} from "@nexus/protocol";
import { asBoolean, asRecord, asString } from "@nexus/protocol";
import type { HostBridge, RuntimeConfig, RuntimeCore } from "./core";
import { hostMessageSchema } from "./messages";
import { RunRegistry } from "./registry";

export type Transport = { send(message: RuntimeMessage): void };

export type CoreFactory = (
  config: RuntimeConfig,
  host: HostBridge,
) => RuntimeCore | Promise<RuntimeCore>;

const CANCELLED_MESSAGE = "The run was cancelled.";

/// Transport-agnostic dispatcher: feed it decoded host messages, it sends
/// runtime messages. One instance per transport connection. The first message
/// must be `init`; the server replies `ready` once the core is constructed.
export class RuntimeServer {
  private registry = new RunRegistry();
  private core?: RuntimeCore;
  private config?: RuntimeConfig;
  private hostPending = new Map<
    string,
    { resolve: (data: string) => void; reject: (error: Error) => void }
  >();
  private nextHostId = 0;

  constructor(
    private createCore: CoreFactory,
    private transport: Transport,
    private version: string,
  ) {}

  /// Validates and routes one message from the host. Malformed messages are
  /// ignored (same posture as the old NDJSON read loop).
  async handleMessage(raw: unknown): Promise<void> {
    const parsed = hostMessageSchema.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data as HostMessage;
    switch (message.kind) {
      case "init":
        return this.handleInit(message.config);
      case "host-response":
        return this.handleHostResponse(message);
      case "request":
        return this.handleRequest(message.id, message.method, message.params);
    }
  }

  /// Transport is going away: fail in-flight host round-trips, abort runs.
  shutdown() {
    for (const pending of this.hostPending.values())
      pending.reject(new Error("The host connection closed."));
    this.hostPending.clear();
    this.registry.abortAll();
  }

  private async handleInit(config: RuntimeConfig) {
    this.config = config;
    this.core = await this.createCore(config, this.hostBridge());
    this.transport.send({ kind: "ready", version: this.version });
  }

  private handleHostResponse(message: {
    id: string;
    ok: boolean;
    result?: { data: string };
    error?: string;
  }) {
    const pending = this.hostPending.get(message.id);
    if (!pending) return;
    this.hostPending.delete(message.id);
    if (message.ok && message.result) pending.resolve(message.result.data);
    else pending.reject(new Error(message.error ?? "The host request failed."));
  }

  private async handleRequest(id: string, method: string, params: unknown) {
    // Transport-level methods answered inline, never dispatched to the core.
    if (method === "cancel") {
      const runId = asString(asRecord(params)?.runId) ?? "";
      if (this.registry.cancel(runId)) {
        this.respondError(runId, CANCELLED_MESSAGE, true);
        this.registry.remove(runId);
      }
      this.respond(id, {});
      return;
    }
    if (method === "agent.approve") {
      const record = asRecord(params);
      this.registry.deliverApproval(
        asString(record?.runId) ?? "",
        asString(record?.callId) ?? "",
        asBoolean(record?.approved) ?? false,
      );
      this.respond(id, {});
      return;
    }
    if (!this.core || !this.config) {
      this.respondError(id, "The runtime is not initialized.");
      return;
    }

    const handle = this.registry.register(id);
    try {
      const result = await this.core.handle(method, params, {
        requestId: id,
        emitter: { emit: (event: RuntimeEvent) => this.emitEvent(id, event) },
        signal: handle.abort.signal,
        host: this.hostBridge(),
        config: this.config,
        onApproval: (handler) => {
          handle.deliverApproval = handler;
        },
      });
      if (this.registry.trySettle(id)) this.respond(id, result ?? {});
    } catch (error) {
      if (this.registry.trySettle(id)) {
        const message =
          error instanceof Error ? error.message : "The request failed.";
        this.respondError(id, message);
      }
    } finally {
      this.registry.remove(id);
    }
  }

  private emitEvent(id: string, event: RuntimeEvent) {
    this.transport.send({ kind: "event", id, event });
  }

  private respond(id: string, result: unknown) {
    this.transport.send({ kind: "response", id, ok: true, result });
  }

  private respondError(id: string, message: string, cancelled?: boolean) {
    this.transport.send({
      kind: "response",
      id,
      ok: false,
      error: cancelled ? { message, cancelled } : { message },
    });
  }

  private hostBridge(): HostBridge {
    const roundTrip = (
      method: "secrets.encrypt" | "secrets.decrypt",
      data: string,
    ) =>
      new Promise<string>((resolve, reject) => {
        const id = `host-${++this.nextHostId}`;
        this.hostPending.set(id, { resolve, reject });
        this.transport.send({
          kind: "host-request",
          id,
          method,
          params: { data },
        });
      });
    return {
      encrypt: (data) => roundTrip("secrets.encrypt", data),
      decrypt: (data) => roundTrip("secrets.decrypt", data),
    };
  }
}
