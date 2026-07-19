import { describe, expect, test } from "bun:test";
import type { HostMessage, HostRequest, HostResponse } from "@nexus/protocol";
import { type RuntimeChild, RuntimeClient } from "./runtime";

class FakeChild implements RuntimeChild {
  posted: HostMessage[] = [];
  killed = false;
  private listeners = new Map<string, ((value: never) => void)[]>();

  postMessage(message: HostMessage) {
    this.posted.push(message);
  }

  on(event: string, listener: (value: never) => void) {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
  }

  kill() {
    this.killed = true;
    return true;
  }

  emit(event: "message" | "exit", value: unknown) {
    for (const listener of this.listeners.get(event) ?? [])
      (listener as (value: unknown) => void)(value);
  }

  ready() {
    this.emit("message", { kind: "ready", version: "0.1.0" });
  }
}

function makeClient(
  onHostRequest?: (request: HostRequest) => Promise<HostResponse>,
) {
  const children: FakeChild[] = [];
  const client = new RuntimeClient({
    fork: () => {
      const child = new FakeChild();
      children.push(child);
      return child;
    },
    init: () => ({
      credentialsDir: "/tmp/creds",
      encryptionAvailable: true,
      appVersion: "1.0.0",
    }),
    onHostRequest:
      onHostRequest ??
      (async (request) => ({
        kind: "host-response",
        id: request.id,
        ok: true,
        result: { data: "ok" },
      })),
  });
  return { client, children };
}

describe("RuntimeClient", () => {
  test("request() is synchronous, sends init first, queues until ready", () => {
    const { client, children } = makeClient();
    const started = client.request("health");
    expect(started.id).toBeTruthy();
    const child = children[0];
    if (!child) throw new Error("no child forked");
    // Only init went out; the request waits for the ready handshake.
    expect(child.posted).toEqual([
      {
        kind: "init",
        config: {
          credentialsDir: "/tmp/creds",
          encryptionAvailable: true,
          appVersion: "1.0.0",
        },
      },
    ]);
    child.ready();
    expect(child.posted[1]).toEqual({
      kind: "request",
      id: started.id,
      method: "health",
      params: {},
    });
  });

  test("responses settle the matching request; errors carry cancelled", async () => {
    const { client, children } = makeClient();
    const a = client.request("health");
    const b = client.request("agent.run");
    const child = children[0];
    if (!child) throw new Error("no child forked");
    child.ready();
    child.emit("message", {
      kind: "response",
      id: a.id,
      ok: true,
      result: { runtime: "nexus-runtime" },
    });
    child.emit("message", {
      kind: "response",
      id: b.id,
      ok: false,
      error: { message: "The run was cancelled.", cancelled: true },
    });
    await expect(a.response).resolves.toEqual({ runtime: "nexus-runtime" });
    const failure = await b.response.catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error & { cancelled?: boolean }).cancelled).toBe(true);
  });

  test("events route to the owning request and are boundary-validated", () => {
    const { client, children } = makeClient();
    const seen: unknown[] = [];
    const run = client.request("agent.run", {}, (event) => seen.push(event));
    const child = children[0];
    if (!child) throw new Error("no child forked");
    child.ready();
    child.emit("message", {
      kind: "event",
      id: run.id,
      event: { type: "assistant_text", text: "hi" },
    });
    // Malformed events are dropped, not delivered.
    child.emit("message", {
      kind: "event",
      id: run.id,
      event: { type: "assistant_text" },
    });
    // Events for other ids are ignored.
    child.emit("message", {
      kind: "event",
      id: "other",
      event: { type: "assistant_text", text: "nope" },
    });
    expect(seen).toEqual([{ type: "assistant_text", text: "hi" }]);
  });

  test("host-requests are serviced and answered on the same child", async () => {
    const { client, children } = makeClient(async (request) => ({
      kind: "host-response",
      id: request.id,
      ok: true,
      result: { data: `enc:${request.params.data}` },
    }));
    client.request("health");
    const child = children[0];
    if (!child) throw new Error("no child forked");
    child.ready();
    child.emit("message", {
      kind: "host-request",
      id: "h1",
      method: "secrets.encrypt",
      params: { data: "s" },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(child.posted).toContainEqual({
      kind: "host-response",
      id: "h1",
      ok: true,
      result: { data: "enc:s" },
    });
  });

  test("child exit fails in-flight requests and the next request respawns", async () => {
    const { client, children } = makeClient();
    const inFlight = client.request("health");
    children[0]?.ready();
    children[0]?.emit("exit", 1);
    const failure = await inFlight.response.catch((error: Error) => error);
    expect((failure as Error).message).toBe(
      "The Nexus runtime stopped unexpectedly.",
    );
    client.request("health");
    expect(children).toHaveLength(2);
  });

  test("ready timeout falls back to the fallback runtime and completes", async () => {
    const children: FakeChild[] = [];
    const fallbacks: FakeChild[] = [];
    const client = new RuntimeClient({
      fork: () => {
        const child = new FakeChild();
        children.push(child);
        return child; // never says ready — simulates the broken handshake
      },
      forkFallback: () => {
        const child = new FakeChild();
        // The real in-process fallback answers init with ready immediately.
        const original = child.postMessage.bind(child);
        child.postMessage = (message) => {
          original(message);
          if ((message as { kind?: string }).kind === "init")
            setTimeout(() => child.ready(), 0);
        };
        fallbacks.push(child);
        return child;
      },
      init: () => ({
        credentialsDir: "/tmp",
        encryptionAvailable: true,
        appVersion: "1.0.0",
      }),
      onHostRequest: async (request) => ({
        kind: "host-response",
        id: request.id,
        ok: false,
        error: "unused",
      }),
      readyTimeoutMs: 5,
    });
    const started = client.request("health");
    await new Promise((resolve) => setTimeout(resolve, 15));
    // The stuck utilityProcess was killed and the fallback engaged.
    expect(children[0]?.killed).toBe(true);
    const fallback = fallbacks[0];
    if (!fallback) throw new Error("fallback not engaged");
    // The original queued request flushed to the fallback and settles.
    expect(fallback.posted).toContainEqual({
      kind: "request",
      id: started.id,
      method: "health",
      params: {},
    });
    fallback.emit("message", {
      kind: "response",
      id: started.id,
      ok: true,
      result: { runtime: "nexus-runtime" },
    });
    await expect(started.response).resolves.toEqual({
      runtime: "nexus-runtime",
    });
    // Subsequent respawns stay on the fallback.
    fallback.emit("exit", 0);
    client.request("health");
    expect(fallbacks).toHaveLength(2);
    expect(children).toHaveLength(1);
  });

  test("ready timeout kills the child and fails pending requests", async () => {
    const children: FakeChild[] = [];
    const client = new RuntimeClient({
      fork: () => {
        const child = new FakeChild();
        children.push(child);
        return child;
      },
      init: () => ({
        credentialsDir: "/tmp",
        encryptionAvailable: false,
        appVersion: "1.0.0",
      }),
      onHostRequest: async (request) => ({
        kind: "host-response",
        id: request.id,
        ok: false,
        error: "unused",
      }),
      readyTimeoutMs: 5,
    });
    const started = client.request("health");
    const failure = await started.response.catch((error: Error) => error);
    expect((failure as Error).message).toBe("The Nexus runtime did not start.");
    expect(children[0]?.killed).toBe(true);
  });
});
