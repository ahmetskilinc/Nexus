import type { RuntimeEmitter } from "@nexus/protocol";

/// Everything the runtime learns from the host at startup (the init message).
export type RuntimeConfig = {
  credentialsDir: string;
  encryptionAvailable: boolean;
  appVersion: string;
};

/// The host services a run can call back into (Electron safeStorage lives in
/// the main process, so encryption is a round-trip over the transport).
export interface HostBridge {
  encrypt(data: string): Promise<string>;
  decrypt(data: string): Promise<string>;
}

/// Per-request context handed to the core with each dispatched method.
export type CoreContext = {
  /// The request id (= the run id for agent.run; used as the checkpoint id).
  requestId: string;
  emitter: RuntimeEmitter;
  /// Aborted when the host cancels this request (or the transport dies).
  signal: AbortSignal;
  host: HostBridge;
  config: RuntimeConfig;
  /// Lets a long-lived run (agent.run) receive `agent.approve` deliveries
  /// addressed to it while it is in flight.
  onApproval(handler: (callId: string, approved: boolean) => void): void;
};

/// The runtime's method surface, minus the transport-level methods the server
/// itself implements (`cancel`, `agent.approve` routing). Implementations
/// throw RuntimeError (or any Error) to produce an error response.
export interface RuntimeCore {
  handle(
    method: string,
    params: unknown,
    context: CoreContext,
  ): Promise<unknown>;
}
