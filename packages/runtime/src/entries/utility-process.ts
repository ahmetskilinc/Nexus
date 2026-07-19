/// The Electron utilityProcess entry — the only transport-aware file in the
/// runtime. Binds a RuntimeServer to `process.parentPort` (available in every
/// utilityProcess without importing electron, keeping this bundle
/// electron-free) and runs a one-time safeStorage round-trip self-test after
/// init so bridge regressions surface in the main-process log immediately.
import { NexusCore } from "../core-impl";
import { RuntimeServer } from "../server";

/// Electron's utilityProcess parentPort surface (typed locally — this bundle
/// must not import electron).
type ParentPort = {
  on(event: "message", listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
};

const parentPort = (process as unknown as { parentPort?: ParentPort })
  .parentPort;
if (!parentPort) {
  console.error("nexus-runtime: not running as a utilityProcess; exiting.");
  process.exit(1);
}
const port = parentPort;

const VERSION = "0.1.0";

const server = new RuntimeServer(
  async (config, host) => {
    if (config.encryptionAvailable) void selfTestSecrets(host);
    else
      console.error(
        "nexus-runtime: safeStorage encryption unavailable; credentials cannot be stored.",
      );
    return new NexusCore(config, host);
  },
  { send: (message) => port.postMessage(message) },
  VERSION,
);

port.on("message", (event) => {
  void server.handleMessage(event.data);
});

async function selfTestSecrets(host: {
  encrypt(data: string): Promise<string>;
  decrypt(data: string): Promise<string>;
}) {
  try {
    const plain = "nexus-secrets-self-test";
    const roundTripped = await host.decrypt(await host.encrypt(plain));
    if (roundTripped !== plain)
      throw new Error("round-trip produced different plaintext");
    console.error("nexus-runtime: safeStorage bridge OK.");
  } catch (error) {
    console.error(
      `nexus-runtime: safeStorage bridge self-test failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
