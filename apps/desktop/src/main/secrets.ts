import type { HostRequest, HostResponse } from "@nexus/protocol";
import { safeStorage } from "electron";

/// Services the runtime's safeStorage bridge. The runtime owns the encrypted
/// credentials file; the main process only performs the OS-keyed encryption —
/// safeStorage is main-process-only, and keeping the crypto here means the
/// runtime never holds the encryption key. Ciphertext travels as base64.
export async function handleSecretsRequest(
  request: HostRequest,
): Promise<HostResponse> {
  try {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error("safeStorage encryption is not available.");
    const data =
      request.method === "secrets.encrypt"
        ? safeStorage.encryptString(request.params.data).toString("base64")
        : safeStorage.decryptString(Buffer.from(request.params.data, "base64"));
    return {
      kind: "host-response",
      id: request.id,
      ok: true,
      result: { data },
    };
  } catch (error) {
    return {
      kind: "host-response",
      id: request.id,
      ok: false,
      error:
        error instanceof Error ? error.message : "The secrets request failed.",
    };
  }
}
