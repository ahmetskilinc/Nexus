import { beforeAll, describe, expect, test } from "bun:test";
import type { AgentMessage } from "@nexus/protocol";
import { collectingEmitter } from "@nexus/protocol";
import { configureModelsDevCache } from "../models-dev";
import { sseFetch } from "../sse.test";
import { ResponseAssembler } from "./assembler";
import { input } from "./input";
import { OpenAiProvider, summarize } from "./provider";

beforeAll(() => configureModelsDevCache(null));

const signal = () => new AbortController().signal;

describe("ResponseAssembler", () => {
  test("backfills empty output from streamed items (ChatGPT quirk)", () => {
    const emitter = collectingEmitter();
    const assembler = new ResponseAssembler();
    assembler.onEvent(
      {
        type: "response.output_item.done",
        item: { type: "message", content: "hi" },
      },
      emitter,
    );
    const terminal = assembler.onEvent(
      { type: "response.completed", response: { id: "r1", output: [] } },
      emitter,
    );
    if (!terminal?.ok) throw new Error("expected ok terminal");
    expect(terminal.response.id).toBe("r1");
    expect((terminal.response.output as unknown[])[0]).toEqual({
      type: "message",
      content: "hi",
    });
  });

  test("keeps populated output and emits text deltas", () => {
    const emitter = collectingEmitter();
    const assembler = new ResponseAssembler();
    assembler.onEvent(
      { type: "response.output_text.delta", delta: "hey" },
      emitter,
    );
    const terminal = assembler.onEvent(
      {
        type: "response.completed",
        response: { output: [{ type: "message" }] },
      },
      emitter,
    );
    if (!terminal?.ok) throw new Error("expected ok terminal");
    expect(terminal.response.output as unknown[]).toHaveLength(1);
    expect(emitter.events).toEqual([{ type: "assistant_text", text: "hey" }]);
  });

  test("surfaces response.failed", () => {
    const terminal = new ResponseAssembler().onEvent(
      {
        type: "response.failed",
        response: { error: { message: "quota exceeded" } },
      },
      collectingEmitter(),
    );
    if (!terminal || terminal.ok) throw new Error("expected error terminal");
    expect(terminal.error.message).toBe("quota exceeded");
  });
});

describe("input mapping", () => {
  test("maps every message kind", () => {
    const history: AgentMessage[] = [
      { type: "user", text: "hi" },
      { type: "tool_call", id: "c1", name: "read_file", arguments: "{}" },
      { type: "tool_result", id: "c1", name: "read_file", output: "text" },
      { type: "assistant_text", text: "answer" },
    ];
    const items = input(history) as Record<string, unknown>[];
    expect(items[0]).toEqual({ role: "user", content: "hi" });
    expect(items[1]?.type).toBe("function_call");
    expect(items[1]?.call_id).toBe("c1");
    expect(items[2]?.type).toBe("function_call_output");
    expect(items[3]).toEqual({ role: "assistant", content: "answer" });
  });
});

function completed(id: string, output: unknown[] = []): string {
  return `data: ${JSON.stringify({
    type: "response.completed",
    response: { id, output, usage: { input_tokens: 5, output_tokens: 3 } },
  })}\n`;
}

describe("OpenAiProvider (fake fetch)", () => {
  test("api-key backend seeds only the last user message when chaining", async () => {
    const bodies: Record<string, unknown>[] = [];
    const capture = ((_: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(init?.body as string));
      return sseFetch([completed("r2")])("https://sse.test");
    }) as unknown as typeof fetch;
    const history: AgentMessage[] = [
      { type: "user", text: "earlier" },
      { type: "assistant_text", text: "done" },
      { type: "user", text: "next question" },
    ];
    const provider = new OpenAiProvider(
      "gpt-5.1",
      "medium",
      "system",
      { kind: "api-key", apiKey: "sk" },
      "r1",
      history,
      [],
    );
    await provider.turn(capture, history, collectingEmitter(), signal());
    expect(bodies[0]?.previous_response_id).toBe("r1");
    expect(bodies[0]?.input).toEqual([
      { role: "user", content: "next question" },
    ]);
    // Chain advances to the new response id.
    expect(provider.responseId()).toBe("r2");
  });

  test("without a chain (history not ending in user) the full history replays", async () => {
    const bodies: Record<string, unknown>[] = [];
    const capture = ((_: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(init?.body as string));
      return sseFetch([completed("r2")])("https://sse.test");
    }) as unknown as typeof fetch;
    const history: AgentMessage[] = [
      { type: "user", text: "q" },
      { type: "assistant_text", text: "a" },
    ];
    const provider = new OpenAiProvider(
      "gpt-5.1",
      "medium",
      "system",
      { kind: "api-key", apiKey: "sk" },
      "r1",
      history,
      [],
    );
    await provider.turn(capture, history, collectingEmitter(), signal());
    expect(bodies[0]?.previous_response_id).toBeUndefined();
    expect(bodies[0]?.input as unknown[]).toHaveLength(2);
  });

  test("noteToolOutput accumulates function_call_output for the next turn", async () => {
    const bodies: Record<string, unknown>[] = [];
    const capture = ((_: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(init?.body as string));
      return sseFetch([completed(`r${bodies.length + 1}`)])("https://sse.test");
    }) as unknown as typeof fetch;
    const history: AgentMessage[] = [{ type: "user", text: "q" }];
    const provider = new OpenAiProvider(
      "gpt-5.1",
      "medium",
      "system",
      { kind: "api-key", apiKey: "sk" },
      undefined,
      history,
      [],
    );
    await provider.turn(capture, history, collectingEmitter(), signal());
    provider.noteToolOutput("call-1", "tool says hi");
    await provider.turn(capture, history, collectingEmitter(), signal());
    expect(bodies[1]?.input).toEqual([
      {
        type: "function_call_output",
        call_id: "call-1",
        output: "tool says hi",
      },
    ]);
    // Second turn chains on the first turn's response id (the fixture
    // returns r2 for the first call).
    expect(bodies[1]?.previous_response_id).toBe("r2");
  });

  test("noteCompaction drops the chain and rebuilds exactly once", async () => {
    const bodies: Record<string, unknown>[] = [];
    const capture = ((_: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(init?.body as string));
      return sseFetch([completed(`r${bodies.length + 1}`)])("https://sse.test");
    }) as unknown as typeof fetch;
    const history: AgentMessage[] = [{ type: "user", text: "q" }];
    const provider = new OpenAiProvider(
      "gpt-5.1",
      "medium",
      "system",
      { kind: "api-key", apiKey: "sk" },
      undefined,
      history,
      [],
    );
    await provider.turn(capture, history, collectingEmitter(), signal());
    provider.noteToolOutput("call-1", "out");
    const compacted: AgentMessage[] = [
      { type: "user", text: "[summary] then q" },
    ];
    provider.noteCompaction();
    await provider.turn(capture, compacted, collectingEmitter(), signal());
    // Rebuilt from canonical history: no chain, full replay of the folded
    // history — not the pending function_call_output items.
    expect(bodies[1]?.previous_response_id).toBeUndefined();
    expect(bodies[1]?.input).toEqual([
      { role: "user", content: "[summary] then q" },
    ]);
    // Rebuild happens exactly once: the next turn chains again on the
    // rebuilt turn's response id.
    await provider.turn(capture, compacted, collectingEmitter(), signal());
    expect(bodies[2]?.previous_response_id).toBe("r3");
  });

  test("chatgpt backend sets store:false, replays history after turn 1, never chains", async () => {
    const bodies: Record<string, unknown>[] = [];
    const headers: Record<string, string>[] = [];
    const capture = ((_: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(init?.body as string));
      headers.push(Object.fromEntries(new Headers(init?.headers).entries()));
      return sseFetch([completed("ignored")])("https://sse.test");
    }) as unknown as typeof fetch;
    const history: AgentMessage[] = [{ type: "user", text: "q" }];
    const provider = new OpenAiProvider(
      "gpt-5.2",
      "medium",
      "system",
      { kind: "chatgpt", accessToken: "tok", accountId: "acct-1" },
      "r-ignored",
      history,
      [],
    );
    await provider.turn(capture, history, collectingEmitter(), signal());
    const grown: AgentMessage[] = [
      ...history,
      { type: "tool_call", id: "c1", name: "grep", arguments: "{}" },
      { type: "tool_result", id: "c1", name: "grep", output: "hit" },
    ];
    provider.noteToolOutput("c1", "hit"); // must be ignored on this backend
    await provider.turn(capture, grown, collectingEmitter(), signal());
    expect(bodies[0]?.store).toBe(false);
    expect(bodies[0]?.previous_response_id).toBeUndefined();
    // Second turn replays the full (grown) history.
    expect(bodies[1]?.input as unknown[]).toHaveLength(3);
    expect(provider.responseId()).toBeUndefined();
    // ChatGPT-specific headers ride every request.
    expect(headers[0]?.["openai-beta"]).toBe("responses=experimental");
    expect(headers[0]?.originator).toBe("codex_cli_rs");
    expect(headers[0]?.["chatgpt-account-id"]).toBe("acct-1");
    expect(headers[0]?.session_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("reasoning.effort rides only for effort-capable models", async () => {
    const bodies: Record<string, unknown>[] = [];
    const capture = ((_: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(init?.body as string));
      return sseFetch([completed("r1")])("https://sse.test");
    }) as unknown as typeof fetch;
    const history: AgentMessage[] = [{ type: "user", text: "q" }];
    for (const model of ["gpt-5.1", "gpt-4o"]) {
      const provider = new OpenAiProvider(
        model,
        "xhigh",
        "system",
        { kind: "api-key", apiKey: "sk" },
        undefined,
        history,
        [],
      );
      await provider.turn(capture, history, collectingEmitter(), signal());
    }
    // gpt-5.1 clamps xhigh → high; gpt-4o sends no reasoning at all.
    expect(bodies[0]?.reasoning).toEqual({ effort: "high" });
    expect(bodies[1]?.reasoning).toBeUndefined();
  });

  test("a stream ending without response.completed is a protocol violation", async () => {
    const history: AgentMessage[] = [{ type: "user", text: "q" }];
    const provider = new OpenAiProvider(
      "gpt-5.1",
      "medium",
      "system",
      { kind: "api-key", apiKey: "sk" },
      undefined,
      history,
      [],
    );
    await expect(
      provider.turn(
        sseFetch(['data: {"type":"response.output_text.delta","delta":"x"}\n']),
        history,
        collectingEmitter(),
        signal(),
      ),
    ).rejects.toThrow("The provider returned an invalid response.");
  });

  test("summarize normalizes output to anthropic content-block shape", async () => {
    const stream = [
      `data: ${JSON.stringify({
        type: "response.completed",
        response: {
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "the summary" }],
            },
          ],
        },
      })}\n`,
    ];
    const result = await summarize(
      sseFetch(stream),
      "https://api.openai.com/v1/responses",
      [],
      "gpt-5.1",
      false,
      "Summarize.",
      "long conversation",
      signal(),
    );
    expect(result.content).toEqual([{ type: "text", text: "the summary" }]);
  });
});
