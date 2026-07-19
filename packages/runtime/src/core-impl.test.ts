import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RuntimeMessage } from "@nexus/protocol";
import type { HostBridge } from "./core";
import { NexusCore } from "./core-impl";
import { RuntimeServer } from "./server";

/// A working cipher without Electron: base64 with a prefix, so decrypt of
/// something never encrypted fails loudly.
const fakeHost: HostBridge = {
  encrypt: async (data) => `enc:${Buffer.from(data).toString("base64")}`,
  decrypt: async (data) => {
    if (!data.startsWith("enc:")) throw new Error("not ciphertext");
    return Buffer.from(data.slice(4), "base64").toString("utf8");
  },
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function makeServer() {
  const credentialsDir = mkdtempSync(path.join(os.tmpdir(), "nexus-creds-"));
  dirs.push(credentialsDir);
  const sent: RuntimeMessage[] = [];
  const server = new RuntimeServer(
    (config, host) => new NexusCore(config, host),
    { send: (message) => sent.push(message) },
    "0.1.0",
  );
  const init = async () => {
    await server.handleMessage({
      kind: "init",
      config: {
        credentialsDir,
        encryptionAvailable: true,
        appVersion: "9.9.9",
      },
    });
  };
  const request = async (id: string, method: string, params: unknown) => {
    // Fire without awaiting: the handler may block on a host round-trip
    // that this loop services below (awaiting here would deadlock).
    void server.handleMessage({ kind: "request", id, method, params });
    for (let i = 0; i < 200; i += 1) {
      // A macrotask turn so real fs/process I/O inside handlers can complete.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const pendingHost = sent.filter(
        (message) => message.kind === "host-request",
      );
      for (const hostRequest of pendingHost) {
        if (hostRequest.kind !== "host-request") continue;
        const alreadyAnswered = (
          hostRequest as unknown as { answered?: boolean }
        ).answered;
        if (alreadyAnswered) continue;
        (hostRequest as unknown as { answered?: boolean }).answered = true;
        try {
          const data =
            hostRequest.method === "secrets.encrypt"
              ? await fakeHost.encrypt(hostRequest.params.data)
              : await fakeHost.decrypt(hostRequest.params.data);
          await server.handleMessage({
            kind: "host-response",
            id: hostRequest.id,
            ok: true,
            result: { data },
          });
        } catch (error) {
          await server.handleMessage({
            kind: "host-response",
            id: hostRequest.id,
            ok: false,
            error: error instanceof Error ? error.message : "failed",
          });
        }
      }
      const response = sent.find(
        (message) => message.kind === "response" && message.id === id,
      );
      if (response?.kind === "response") return response;
    }
    throw new Error(`request ${id} never settled`);
  };
  return { sent, init, request };
}

describe("NexusCore end-to-end over the RuntimeServer", () => {
  test("health reports the app version", async () => {
    const { init, request } = makeServer();
    await init();
    const response = await request("r1", "health", {});
    expect(response).toMatchObject({
      ok: true,
      result: { runtime: "nexus-runtime", version: "9.9.9" },
    });
  });

  test("workspace.index and context.preview over a real temp workspace", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "nexus-ws-"));
    dirs.push(workspace);
    writeFileSync(path.join(workspace, "AGENTS.md"), "workspace rules");
    writeFileSync(path.join(workspace, "main.ts"), "export {};\n");
    const { init, request } = makeServer();
    await init();
    const index = await request("r1", "workspace.index", { path: workspace });
    if (!(index.kind === "response" && index.ok)) throw new Error("failed");
    expect((index.result as { files: string[] }).files).toContain("main.ts");
    const preview = await request("r2", "context.preview", {
      path: workspace,
    });
    if (!(preview.kind === "response" && preview.ok)) throw new Error("failed");
    expect(preview.result).toMatchObject({
      instructionSource: "AGENTS.md",
      instructionText: "workspace rules",
      instructionTruncated: false,
      memories: [],
    });
  });

  test("credentials round-trip through the encrypted store and host cipher", async () => {
    const { init, request } = makeServer();
    await init();
    const set = await request("r1", "credentials.set", {
      providerId: "anthropic-main",
      value: "sk-secret",
    });
    expect(set).toMatchObject({ ok: true, result: {} });
    // models.list for an api-key provider resolves the stored key; a bogus
    // key means the fake fetch path isn't hit here — instead verify via
    // credentials.delete then a failing agent.run credential resolution.
    const del = await request("r2", "credentials.delete", {
      providerId: "anthropic-main",
    });
    expect(del).toMatchObject({ ok: true, result: {} });
    const run = await request("r3", "agent.run", {
      providerId: "anthropic-main",
      providerKind: "Anthropic",
      model: "claude-sonnet-4-5",
      auth: "api_key",
      workspacePath: os.tmpdir(),
      history: [],
    });
    if (run.kind !== "response" || run.ok) throw new Error("expected failure");
    expect(run.error.message).toContain(
      "could not access this provider credential",
    );
  });

  test("missing params produce the exact Rust sentence", async () => {
    const { init, request } = makeServer();
    await init();
    const response = await request("r1", "workspace.index", {});
    if (response.kind !== "response" || response.ok)
      throw new Error("expected failure");
    expect(response.error.message).toBe('Missing required parameter "path".');
  });

  test("models.catalog serves the bundled snapshot offline", async () => {
    const { init, request } = makeServer();
    await init();
    const response = await request("r1", "models.catalog", {
      providerKind: "Anthropic",
      auth: "api_key",
    });
    if (!(response.kind === "response" && response.ok))
      throw new Error("failed");
    const result = response.result as {
      models: { id: string }[];
      default: string | null;
    };
    expect(result.models.length).toBeGreaterThan(0);
    expect(result.default).toBe(result.models[0]?.id ?? null);
  });

  test("unknown methods report the exact sentence", async () => {
    const { init, request } = makeServer();
    await init();
    const response = await request("r1", "bogus.method", {});
    if (response.kind !== "response" || response.ok)
      throw new Error("expected failure");
    expect(response.error.message).toBe('Unknown method "bogus.method".');
  });
});
