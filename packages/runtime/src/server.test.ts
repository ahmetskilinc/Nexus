import { describe, expect, test } from "bun:test";
import type { RuntimeMessage } from "@nexus/protocol";
import type { CoreContext, RuntimeCore } from "./core";
import { RuntimeServer } from "./server";
import { StubCore } from "./stub-core";

const INIT = {
  kind: "init",
  config: {
    credentialsDir: "/tmp/creds",
    encryptionAvailable: true,
    appVersion: "1.2.3",
  },
};

function makeServer(core?: RuntimeCore) {
  const sent: RuntimeMessage[] = [];
  const server = new RuntimeServer(
    () => core ?? new StubCore(),
    { send: (message) => sent.push(message) },
    "0.1.0",
  );
  return { server, sent };
}

async function settle() {
  // Drain microtasks so async handlers finish.
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

describe("RuntimeServer", () => {
  test("init → ready handshake, then health round-trips", async () => {
    const { server, sent } = makeServer();
    await server.handleMessage(INIT);
    expect(sent[0]).toEqual({ kind: "ready", version: "0.1.0" });
    await server.handleMessage({
      kind: "request",
      id: "r1",
      method: "health",
      params: {},
    });
    await settle();
    expect(sent[1]).toEqual({
      kind: "response",
      id: "r1",
      ok: true,
      result: { runtime: "nexus-runtime", version: "1.2.3" },
    });
  });

  test("requests before init fail explicitly", async () => {
    const { server, sent } = makeServer();
    await server.handleMessage({
      kind: "request",
      id: "r1",
      method: "health",
      params: {},
    });
    await settle();
    expect(sent[0]).toMatchObject({
      kind: "response",
      id: "r1",
      ok: false,
      error: { message: "The runtime is not initialized." },
    });
  });

  test("unknown methods produce error responses", async () => {
    const { server, sent } = makeServer();
    await server.handleMessage(INIT);
    await server.handleMessage({
      kind: "request",
      id: "r1",
      method: "workspace.index",
      params: {},
    });
    await settle();
    expect(sent[1]).toMatchObject({
      kind: "response",
      id: "r1",
      ok: false,
    });
  });

  test("cancel aborts a live run, emits cancelled on the run id, suppresses the run's own result", async () => {
    let resolveRun: (() => void) | undefined;
    const core: RuntimeCore = {
      handle: (_method, _params, context: CoreContext) =>
        new Promise((resolve) => {
          resolveRun = () => resolve({ done: true });
          context.signal.addEventListener("abort", () =>
            resolve({ done: true }),
          );
        }),
    };
    const { server, sent } = makeServer(core);
    await server.handleMessage(INIT);
    void server.handleMessage({
      kind: "request",
      id: "run-1",
      method: "agent.run",
      params: {},
    });
    await settle();
    await server.handleMessage({
      kind: "request",
      id: "c-1",
      method: "cancel",
      params: { runId: "run-1" },
    });
    await settle();
    resolveRun?.();
    await settle();
    const forRun = sent.filter(
      (message) => message.kind === "response" && message.id === "run-1",
    );
    expect(forRun).toEqual([
      {
        kind: "response",
        id: "run-1",
        ok: false,
        error: { message: "The run was cancelled.", cancelled: true },
      },
    ]);
    // Cancel itself always answers {}.
    expect(sent).toContainEqual({
      kind: "response",
      id: "c-1",
      ok: true,
      result: {},
    });
  });

  test("serializes agent runs while allowing ordinary requests through", async () => {
    let releaseFirst: (() => void) | undefined;
    const started: string[] = [];
    const core: RuntimeCore = {
      handle: (method, _params, context) => {
        if (method === "health") return Promise.resolve({ runtime: "ok" });
        started.push(context.requestId);
        if (context.requestId === "run-1")
          return new Promise((resolve) => {
            releaseFirst = () => resolve({ done: true });
          });
        return Promise.resolve({ done: true });
      },
    };
    const { server, sent } = makeServer(core);
    await server.handleMessage(INIT);
    void server.handleMessage({
      kind: "request",
      id: "run-1",
      method: "agent.run",
      params: {},
    });
    void server.handleMessage({
      kind: "request",
      id: "run-2",
      method: "agent.run",
      params: {},
    });
    await server.handleMessage({
      kind: "request",
      id: "health",
      method: "health",
      params: {},
    });
    await settle();
    expect(started).toEqual(["run-1"]);
    expect(sent).toContainEqual({
      kind: "event",
      id: "run-2",
      event: { type: "agent_queued" },
    });
    expect(sent).toContainEqual({
      kind: "response",
      id: "health",
      ok: true,
      result: { runtime: "ok" },
    });
    releaseFirst?.();
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(started).toEqual(["run-1", "run-2"]);
  });

  test("cancelling a queued agent run prevents it from starting", async () => {
    let releaseFirst: (() => void) | undefined;
    const started: string[] = [];
    const core: RuntimeCore = {
      handle: (_method, _params, context) => {
        started.push(context.requestId);
        if (context.requestId === "run-1")
          return new Promise((resolve) => {
            releaseFirst = () => resolve({ done: true });
          });
        return Promise.resolve({ done: true });
      },
    };
    const { server, sent } = makeServer(core);
    await server.handleMessage(INIT);
    void server.handleMessage({
      kind: "request",
      id: "run-1",
      method: "agent.run",
      params: {},
    });
    void server.handleMessage({
      kind: "request",
      id: "run-2",
      method: "agent.run",
      params: {},
    });
    await settle();
    await server.handleMessage({
      kind: "request",
      id: "cancel-2",
      method: "cancel",
      params: { runId: "run-2" },
    });
    releaseFirst?.();
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(started).toEqual(["run-1"]);
    expect(sent).toContainEqual({
      kind: "response",
      id: "run-2",
      ok: false,
      error: { message: "The run was cancelled.", cancelled: true },
    });
  });

  test("cancel for an unknown run still answers {} and emits nothing else", async () => {
    const { server, sent } = makeServer();
    await server.handleMessage(INIT);
    await server.handleMessage({
      kind: "request",
      id: "c-1",
      method: "cancel",
      params: { runId: "nope" },
    });
    await settle();
    expect(sent.slice(1)).toEqual([
      { kind: "response", id: "c-1", ok: true, result: {} },
    ]);
  });

  test("agent.approve routes to the run's registered handler and answers {}", async () => {
    const seen: Array<[string, boolean]> = [];
    const core: RuntimeCore = {
      handle: (_method, _params, context) =>
        new Promise((resolve) => {
          context.onApproval((callId, approved) => {
            seen.push([callId, approved]);
            resolve({});
          });
        }),
    };
    const { server, sent } = makeServer(core);
    await server.handleMessage(INIT);
    void server.handleMessage({
      kind: "request",
      id: "run-1",
      method: "agent.run",
      params: {},
    });
    await settle();
    await server.handleMessage({
      kind: "request",
      id: "a-1",
      method: "agent.approve",
      params: { runId: "run-1", callId: "call-9", approved: true },
    });
    await settle();
    expect(seen).toEqual([["call-9", true]]);
    expect(sent).toContainEqual({
      kind: "response",
      id: "a-1",
      ok: true,
      result: {},
    });
    expect(sent).toContainEqual({
      kind: "response",
      id: "run-1",
      ok: true,
      result: {},
    });
  });

  test("agent.answer_question routes to the run's registered handler", async () => {
    const seen: Array<[string, string]> = [];
    const core: RuntimeCore = {
      handle: (_method, _params, context) =>
        new Promise((resolve) => {
          context.onQuestionAnswer((callId, answer) => {
            seen.push([callId, answer]);
            resolve({});
          });
        }),
    };
    const { server, sent } = makeServer(core);
    await server.handleMessage(INIT);
    void server.handleMessage({
      kind: "request",
      id: "run-1",
      method: "agent.run",
      params: {},
    });
    await settle();
    await server.handleMessage({
      kind: "request",
      id: "q-1",
      method: "agent.answer_question",
      params: { runId: "run-1", callId: "call-9", answer: "PostgreSQL" },
    });
    await settle();
    expect(seen).toEqual([["call-9", "PostgreSQL"]]);
    expect(sent).toContainEqual({
      kind: "response",
      id: "q-1",
      ok: true,
      result: {},
    });
  });

  test("events stream on the originating request id", async () => {
    const core: RuntimeCore = {
      handle: async (_method, _params, context) => {
        context.emitter.emit({ type: "assistant_text", text: "hi" });
        return {};
      },
    };
    const { server, sent } = makeServer(core);
    await server.handleMessage(INIT);
    await server.handleMessage({
      kind: "request",
      id: "run-1",
      method: "agent.run",
      params: {},
    });
    await settle();
    expect(sent[1]).toEqual({
      kind: "event",
      id: "run-1",
      event: { type: "assistant_text", text: "hi" },
    });
    expect(sent[2]).toMatchObject({ kind: "response", id: "run-1", ok: true });
  });

  test("host bridge round-trips through host-request/host-response", async () => {
    const core: RuntimeCore = {
      handle: async (_method, _params, context) => ({
        cipher: await context.host.encrypt("secret"),
      }),
    };
    const { server, sent } = makeServer(core);
    await server.handleMessage(INIT);
    void server.handleMessage({
      kind: "request",
      id: "r1",
      method: "credentials.set",
      params: {},
    });
    await settle();
    const hostRequest = sent.find((message) => message.kind === "host-request");
    expect(hostRequest).toMatchObject({
      method: "secrets.encrypt",
      params: { data: "secret" },
    });
    if (hostRequest?.kind !== "host-request") throw new Error("unreachable");
    await server.handleMessage({
      kind: "host-response",
      id: hostRequest.id,
      ok: true,
      result: { data: "ENCRYPTED" },
    });
    await settle();
    expect(sent).toContainEqual({
      kind: "response",
      id: "r1",
      ok: true,
      result: { cipher: "ENCRYPTED" },
    });
  });

  test("malformed messages are ignored", async () => {
    const { server, sent } = makeServer();
    await server.handleMessage(null);
    await server.handleMessage({ kind: "request" });
    await server.handleMessage("garbage");
    expect(sent).toEqual([]);
  });
});
