import { beforeAll, describe, expect, test } from "bun:test";
import type { AgentMessage } from "@nexus/protocol";
import { collectingEmitter } from "@nexus/protocol";
import { configureModelsDevCache } from "../models-dev";
import { sseFetch } from "../sse.test";
import { ContentAssembler } from "./assembler";
import { messages } from "./fold";
import { AnthropicProvider, summarize } from "./provider";

beforeAll(() => configureModelsDevCache(null));

const signal = () => new AbortController().signal;

describe("ContentAssembler", () => {
  test("accumulates text and emits deltas", () => {
    const emitter = collectingEmitter();
    const assembler = new ContentAssembler();
    expect(
      assembler.onEvent(
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text" },
        },
        emitter,
      ),
    ).toBeUndefined();
    for (const fragment of ["Hel", "lo"]) {
      assembler.onEvent(
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: fragment },
        },
        emitter,
      );
    }
    assembler.onEvent({ type: "content_block_stop", index: 0 }, emitter);
    const terminal = assembler.onEvent({ type: "message_stop" }, emitter);
    if (!terminal?.ok) throw new Error("expected ok terminal");
    expect(terminal.response).toEqual({
      content: [{ type: "text", text: "Hello" }],
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    // One assistant_text event per non-empty fragment.
    expect(emitter.events).toEqual([
      { type: "assistant_text", text: "Hel" },
      { type: "assistant_text", text: "lo" },
    ]);
  });

  test("assembles tool_use input from partial json deltas", () => {
    const emitter = collectingEmitter();
    const assembler = new ContentAssembler();
    assembler.onEvent(
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "t1", name: "grep" },
      },
      emitter,
    );
    for (const fragment of ['{"patt', 'ern":"x"}']) {
      assembler.onEvent(
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: fragment },
        },
        emitter,
      );
    }
    assembler.onEvent({ type: "content_block_stop", index: 0 }, emitter);
    const terminal = assembler.onEvent({ type: "message_stop" }, emitter);
    if (!terminal?.ok) throw new Error("expected ok terminal");
    expect(terminal.response.content[0]).toEqual({
      type: "tool_use",
      id: "t1",
      name: "grep",
      input: { pattern: "x" },
    });
  });

  test("surfaces mid-stream errors", () => {
    const emitter = collectingEmitter();
    const assembler = new ContentAssembler();
    const terminal = assembler.onEvent(
      { type: "error", error: { message: "overloaded" } },
      emitter,
    );
    if (!terminal || terminal.ok) throw new Error("expected error terminal");
    expect(terminal.error.message).toBe("overloaded");
  });

  test("finish returns completed blocks when the connection drops", () => {
    const emitter = collectingEmitter();
    const assembler = new ContentAssembler();
    assembler.onEvent(
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text" },
      },
      emitter,
    );
    assembler.onEvent(
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "partial" },
      },
      emitter,
    );
    assembler.onEvent({ type: "content_block_stop", index: 0 }, emitter);
    // No message_stop — the connection dropped.
    expect(assembler.finish()).toEqual({
      content: [{ type: "text", text: "partial" }],
      usage: { input_tokens: 0, output_tokens: 0 },
    });
  });

  test("captures usage from start and delta events", () => {
    const emitter = collectingEmitter();
    const assembler = new ContentAssembler();
    assembler.onEvent(
      {
        type: "message_start",
        message: {
          usage: {
            input_tokens: 90,
            cache_read_input_tokens: 10,
            output_tokens: 1,
          },
        },
      },
      emitter,
    );
    // message_delta output counts are cumulative — the latest wins.
    assembler.onEvent(
      { type: "message_delta", usage: { output_tokens: 12 } },
      emitter,
    );
    assembler.onEvent(
      { type: "message_delta", usage: { output_tokens: 34 } },
      emitter,
    );
    const terminal = assembler.onEvent({ type: "message_stop" }, emitter);
    if (!terminal?.ok) throw new Error("expected ok terminal");
    expect(terminal.response.usage).toEqual({
      input_tokens: 100,
      output_tokens: 34,
    });
  });
});

describe("messages fold", () => {
  test("folds history into role blocks", () => {
    const history: AgentMessage[] = [
      { type: "user", text: "hi" },
      { type: "assistant_text", text: "looking" },
      {
        type: "tool_call",
        id: "t1",
        name: "grep",
        arguments: '{"pattern":"x"}',
      },
      { type: "tool_result", id: "t1", name: "grep", output: "No matches." },
      { type: "assistant_text", text: "done" },
    ];
    const folded = messages(history) as {
      role: string;
      content: unknown;
    }[];
    expect(folded).toHaveLength(4);
    expect(folded[0]).toEqual({ role: "user", content: "hi" });
    expect(folded[1]?.role).toBe("assistant");
    const assistant = folded[1]?.content as Record<string, unknown>[];
    expect(assistant).toHaveLength(2);
    expect(assistant[1]?.type).toBe("tool_use");
    expect(assistant[1]?.input).toEqual({ pattern: "x" });
    expect(folded[2]?.role).toBe("user");
    const results = folded[2]?.content as Record<string, unknown>[];
    expect(results[0]?.tool_use_id).toBe("t1");
    expect(folded[3]?.role).toBe("assistant");
  });
});

describe("AnthropicProvider.turn (fake fetch)", () => {
  const stream = [
    'data: {"type":"message_start","message":{"usage":{"input_tokens":10,"output_tokens":1}}}\n',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n',
    'data: {"type":"content_block_stop","index":0}\n',
    'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"t1","name":"read_file"}}\n',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"a\\"}"}}\n',
    'data: {"type":"content_block_stop","index":1}\n',
    'data: {"type":"message_delta","usage":{"output_tokens":7}}\n',
    'data: {"type":"message_stop"}\n',
  ];

  test("streams deltas and returns texts, tool calls, and usage", async () => {
    const emitter = collectingEmitter();
    const provider = AnthropicProvider.anthropic(
      "claude-sonnet-4-5",
      "minimal",
      "system",
      "sk-key",
      [],
    );
    const turn = await provider.turn(
      sseFetch(stream),
      [{ type: "user", text: "hi" }],
      emitter,
      signal(),
    );
    expect(turn.texts).toEqual(["Hi"]);
    expect(turn.toolCalls).toEqual([
      { id: "t1", name: "read_file", arguments: '{"path":"a"}' },
    ]);
    expect(turn.usage).toEqual({ inputTokens: 10, outputTokens: 7 });
    expect(emitter.events).toEqual([{ type: "assistant_text", text: "Hi" }]);
  });

  test("thinking budget raises max_tokens for effort-capable models", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const fetchFn = ((input: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return sseFetch(stream)(input, init);
    }) as unknown as typeof fetch;
    const provider = AnthropicProvider.anthropic(
      "claude-sonnet-4-5",
      "high",
      "system",
      "sk-key",
      [],
    );
    await provider.turn(
      fetchFn,
      [{ type: "user", text: "hi" }],
      collectingEmitter(),
      signal(),
    );
    expect(capturedBody?.thinking).toEqual({
      type: "enabled",
      budget_tokens: 16384,
    });
    expect(capturedBody?.max_tokens).toBe(32768);
  });

  test("summarize returns content blocks without emitting UI events", async () => {
    const result = await summarize(
      sseFetch([
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"summary"}}\n',
        'data: {"type":"content_block_stop","index":0}\n',
        'data: {"type":"message_stop"}\n',
      ]),
      "https://api.anthropic.com/v1/messages",
      [],
      "claude-sonnet-4-5",
      "Summarize.",
      "long conversation",
      signal(),
    );
    expect(result.content).toEqual([{ type: "text", text: "summary" }]);
  });
});
