import type { RuntimeEvent } from "./events";

/// Message envelopes between the Electron main process and the runtime
/// utilityProcess (structured-clone over the fork's parentPort). The envelope
/// semantics mirror the retired NDJSON protocol: requests correlate by `id`,
/// a run streams `event` messages before settling with exactly one `response`,
/// and `agent.approve`/`cancel` reference another request's id via params.
export type RpcRequest = {
  kind: "request";
  id: string;
  method: string;
  params: unknown;
};

export type RpcResponse =
  | { kind: "response"; id: string; ok: true; result: unknown }
  | {
      kind: "response";
      id: string;
      ok: false;
      error: { message: string; cancelled?: boolean };
    };

export type RpcEvent = {
  kind: "event";
  /// The id of the originating request (the run this event belongs to).
  id: string;
  event: RuntimeEvent;
};

/// Reverse direction: the runtime asking the main process to encrypt/decrypt a
/// credential blob with Electron safeStorage (main-process-only API).
export type HostRequest = {
  kind: "host-request";
  id: string;
  method: "secrets.encrypt" | "secrets.decrypt";
  params: { data: string };
};

export type HostResponse = {
  kind: "host-response";
  id: string;
  ok: boolean;
  result?: { data: string };
  error?: string;
};

/// First message after fork: everything the runtime needs from the host.
export type InitMessage = {
  kind: "init";
  config: {
    /// Directory for the encrypted credentials file (under userData).
    credentialsDir: string;
    /// Whether safeStorage has a working OS-keychain-backed key.
    encryptionAvailable: boolean;
    /// App version, reported by the `health` method.
    appVersion: string;
  };
};

export type ReadyMessage = { kind: "ready"; version: string };

/// Runtime → main.
export type RuntimeMessage =
  | RpcResponse
  | RpcEvent
  | HostRequest
  | ReadyMessage;
/// Main → runtime.
export type HostMessage = RpcRequest | HostResponse | InitMessage;
