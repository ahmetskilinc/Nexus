import type { HostMessage } from "@nexus/protocol";
import { NexusCore, RuntimeServer } from "@nexus/runtime";
import type { RuntimeChild } from "./runtime";

/// An in-process stand-in for the runtime utilityProcess, wired straight into
/// the transport-agnostic RuntimeServer. Used as a fallback when the real
/// utilityProcess never completes its IPC handshake — Chromium's Mach-port
/// rendezvous peer validation currently breaks utility processes in
/// Developer-ID-signed builds on recent macOS (child boots, no messages
/// flow). Trades away crash isolation, nothing else: same core, same
/// messages, same safeStorage bridge through onHostRequest.
export function forkInProcessRuntime(): RuntimeChild {
  let messageListeners: ((message: unknown) => void)[] = [];
  const server = new RuntimeServer(
    (config, host) => new NexusCore(config, host),
    {
      send: (message) => {
        for (const listener of messageListeners) listener(message);
      },
    },
    "0.1.0",
  );
  return {
    postMessage(message: HostMessage) {
      void server.handleMessage(message);
    },
    on(event, listener) {
      // The in-process runtime never exits on its own; only messages matter.
      if (event === "message")
        messageListeners.push(listener as (message: unknown) => void);
    },
    kill() {
      server.shutdown();
      messageListeners = [];
      return true;
    },
  };
}
