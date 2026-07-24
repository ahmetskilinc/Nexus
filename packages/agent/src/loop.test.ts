import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { McpHub } from "@nexus/mcp";
import type { AgentMessage } from "@nexus/protocol";
import { collectingEmitter } from "@nexus/protocol";
import type { Provider, ToolCall, Turn, Usage } from "@nexus/providers";
import { Toolbox } from "@nexus/tools";
import { CheckpointRecorder } from "@nexus/workspace";
import { ApprovalMailbox } from "./approvals";
import { runLoop, Summarizer } from "./loop";
import type { ApprovalMode } from "./modes";
import { runSubagentLoop, SubagentLauncher } from "./subagent";
import { ToolRunner } from "./tool-runner";

/// Scripted provider: turns pop front-to-back. Records everything
/// noteToolOutput receives. Mirrors the Rust FakeProvider.
class FakeProvider implements Provider {
  outputs: [string, string][] = [];
  id: string | undefined;
  constructor(private script: Turn[]) {}

  turn(): Promise<Turn> {
    const next = this.script.shift();
    if (!next) return Promise.reject(new Error("script exhausted"));
    return Promise.resolve(next);
  }

  noteToolOutput(callId: string, output: string): void {
    this.outputs.push([callId, output]);
  }

  noteCompaction(): void {}

  responseId(): string | undefined {
    return this.id;
  }
}

const usage0: Usage = { inputTokens: 0, outputTokens: 0 };
const textTurn = (text: string, usage = usage0): Turn => ({
  texts: [text],
  toolCalls: [],
  usage,
});
const toolTurn = (
  id: string,
  name: string,
  argumentsJson: string,
  usage = usage0,
): Turn => ({
  texts: [],
  toolCalls: [{ id, name, arguments: argumentsJson }],
  usage,
});

const rejectingFetch = (() =>
  Promise.reject(new Error("no network in tests"))) as unknown as typeof fetch;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

async function harness(mode: ApprovalMode = "auto") {
  const dir = mkdtempSync(path.join(os.tmpdir(), "nexus-agent-test-"));
  dirs.push(dir);
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "nexus-agent-data-"));
  dirs.push(dataDir);
  writeFileSync(path.join(dir, "notes.txt"), "alpha\nbeta\ngamma\n");
  const emitter = collectingEmitter();
  const hub = await McpHub.connect([]);
  const mailbox = new ApprovalMailbox();
  const controller = new AbortController();
  const runner = new ToolRunner({
    fetchFn: rejectingFetch,
    toolbox: new Toolbox(dir),
    workspace: dir,
    hub,
    emitter,
    mode,
    commandEnvironment: "restricted",
    webAccess: true,
    subagent: new SubagentLauncher({
      kind: "Anthropic",
      model: "",
      effort: "medium",
      credential: { kind: "api_key", apiKey: "" },
    }),
    signal: controller.signal,
  });
  const checkpoint = new CheckpointRecorder(dir, "test-run", { dataDir });
  const eventNames = () => emitter.events.map((event) => event.type);
  return { dir, emitter, runner, checkpoint, mailbox, eventNames, controller };
}

const placeholderSummarizer = new Summarizer({
  kind: "Anthropic",
  model: "",
  endpoint: "http://127.0.0.1:1/never",
  headers: [],
  chatgptBackend: false,
});

function loopDefaults(h: Awaited<ReturnType<typeof harness>>) {
  return {
    runner: h.runner,
    checkpoint: h.checkpoint,
    mailbox: h.mailbox,
    summarizer: placeholderSummarizer,
    fetchFn: rejectingFetch,
    contextTokens: undefined as number | undefined,
    maxToolRounds: 50,
    maxRunSeconds: 900,
    maxRunCostUsd: undefined as number | undefined,
  };
}

describe("runLoop", () => {
  test("failed compaction leaves history and continues", async () => {
    // A context window of 0 forces shouldCompact true for any sizable
    // history; the placeholder summarizer can't reach a provider, so the
    // summary errors and the loop must carry on uncompacted.
    const h = await harness();
    const history: AgentMessage[] = [];
    for (let i = 0; i < 10; i += 1) {
      history.push({ type: "user", text: `message ${i} ${"x".repeat(2000)}` });
      history.push({ type: "assistant_text", text: "working" });
    }
    const originalLength = history.length;
    const result = await runLoop({
      ...loopDefaults(h),
      provider: new FakeProvider([textTurn("done")]),
      messages: history,
      contextTokens: 0,
    });
    // The run completed and history grew by the assistant reply — no fold.
    expect(result.messages).toHaveLength(originalLength + 1);
    expect(h.eventNames()).not.toContain("compacted");
  });

  test("empty tool calls ends the run", async () => {
    const h = await harness();
    const provider = new FakeProvider([textTurn("hi")]);
    provider.id = "resp-9";
    const result = await runLoop({
      ...loopDefaults(h),
      provider,
      messages: [{ type: "user", text: "hey" }],
    });
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1]).toEqual({ type: "assistant_text", text: "hi" });
    expect(result.openaiResponseId).toBe("resp-9");
    expect(result.checkpoint).toBeNull();
  });

  test("each turn reports the context meter's reading", async () => {
    const h = await harness();
    const provider = new FakeProvider([
      toolTurn("c1", "git_status", "{}", {
        inputTokens: 100,
        outputTokens: 20,
      }),
      textTurn("done", { inputTokens: 250, outputTokens: 40 }),
    ]);
    await runLoop({
      ...loopDefaults(h),
      provider,
      messages: [],
      contextTokens: 1000,
    });
    // Per turn, not cumulative: the meter shows what the *next* request will
    // carry, so each reading replaces the last.
    expect(
      h.emitter.events.filter((event) => event.type === "context"),
    ).toEqual([
      { type: "context", usedTokens: 120, contextTokens: 1000 },
      { type: "context", usedTokens: 290, contextTokens: 1000 },
    ]);
  });

  test("an unknown context window falls back to the default", async () => {
    const h = await harness();
    await runLoop({
      ...loopDefaults(h),
      provider: new FakeProvider([textTurn("hi")]),
      messages: [],
    });
    expect(
      h.emitter.events.find((event) => event.type === "context"),
    ).toMatchObject({ contextTokens: 200_000 });
  });

  test("usage accumulates across turns", async () => {
    const h = await harness();
    const provider = new FakeProvider([
      toolTurn("c1", "git_status", "{}", {
        inputTokens: 100,
        outputTokens: 20,
      }),
      textTurn("done", { inputTokens: 250, outputTokens: 40 }),
    ]);
    const result = await runLoop({
      ...loopDefaults(h),
      provider,
      messages: [],
    });
    expect(result.usage).toEqual({ inputTokens: 350, outputTokens: 60 });
  });

  test("tool call round-trips through history and provider", async () => {
    const h = await harness();
    const provider = new FakeProvider([
      toolTurn("c1", "read_file", '{"path": "notes.txt"}'),
      textTurn("done"),
    ]);
    const result = await runLoop({
      ...loopDefaults(h),
      provider,
      messages: [],
    });
    // History order: tool_call, tool_result, assistant_text.
    expect(result.messages[0]).toMatchObject({ type: "tool_call", id: "c1" });
    const toolResult = result.messages[1];
    if (toolResult?.type !== "tool_result") throw new Error("expected result");
    expect(toolResult.output).toContain("alpha");
    expect(result.messages[2]).toEqual({
      type: "assistant_text",
      text: "done",
    });
    // The provider was fed the output for its next request.
    expect(provider.outputs).toHaveLength(1);
    expect(provider.outputs[0]?.[0]).toBe("c1");
    expect(provider.outputs[0]?.[1]).toContain("alpha");
    // Events reached the UI.
    expect(h.eventNames()).toContain("tool_call");
    expect(h.eventNames()).toContain("tool_result");
  });

  test("declined edit reports the decline and leaves disk untouched", async () => {
    const h = await harness("ask");
    const provider = new FakeProvider([
      toolTurn(
        "c1",
        "edit_file",
        '{"path": "notes.txt", "old_string": "alpha", "new_string": "OMEGA"}',
      ),
      textTurn("ok"),
    ]);
    // The mailbox buffers early replies: the decline is queued before the
    // loop requests approval.
    h.mailbox.deliver({ callId: "c1", approved: false });
    const result = await runLoop({
      ...loopDefaults(h),
      provider,
      messages: [],
    });
    const declined = result.messages[1];
    if (declined?.type !== "tool_result") throw new Error("expected result");
    expect(declined.output).toBe("The user declined this edit.");
    expect(readFileSync(path.join(h.dir, "notes.txt"), "utf8")).toBe(
      "alpha\nbeta\ngamma\n",
    );
    expect(h.eventNames()).toContain("approval_request");
  });

  test("declined command is not run", async () => {
    const h = await harness("ask");
    const provider = new FakeProvider([
      toolTurn("c1", "run_command", '{"command": "touch marker.txt"}'),
      textTurn("ok"),
    ]);
    h.mailbox.deliver({ callId: "c1", approved: false });
    const result = await runLoop({
      ...loopDefaults(h),
      provider,
      messages: [],
    });
    const declined = result.messages[1];
    if (declined?.type !== "tool_result") throw new Error("expected result");
    expect(declined.output).toBe("The user declined to run this command.");
    expect(existsSync(path.join(h.dir, "marker.txt"))).toBe(false);
  });

  test("approved edit applies and records a checkpoint", async () => {
    const h = await harness("ask");
    const provider = new FakeProvider([
      toolTurn(
        "c1",
        "edit_file",
        '{"path": "notes.txt", "old_string": "alpha", "new_string": "OMEGA"}',
      ),
      textTurn("ok"),
    ]);
    h.mailbox.deliver({ callId: "c1", approved: true });
    const result = await runLoop({
      ...loopDefaults(h),
      provider,
      messages: [],
    });
    expect(readFileSync(path.join(h.dir, "notes.txt"), "utf8")).toBe(
      "OMEGA\nbeta\ngamma\n",
    );
    expect(result.checkpoint?.files).toEqual(["notes.txt"]);
  });

  test("time budget trips with the exact sentence", async () => {
    const h = await harness();
    await expect(
      runLoop({
        ...loopDefaults(h),
        provider: new FakeProvider([textTurn("never reached")]),
        messages: [],
        maxRunSeconds: 0,
      }),
    ).rejects.toThrow("The run reached its 0-second time budget.");
  });

  test("tool-round budget trips with the exact sentence", async () => {
    const h = await harness();
    const provider = new FakeProvider([
      toolTurn("c1", "git_status", "{}"),
      toolTurn("c2", "git_status", "{}"),
      textTurn("never"),
    ]);
    await expect(
      runLoop({
        ...loopDefaults(h),
        provider,
        messages: [],
        maxToolRounds: 1,
      }),
    ).rejects.toThrow(
      "The run reached its 1-round tool budget. Continue in a new message if more work is needed.",
    );
  });

  test("cost budget trips using catalog pricing", async () => {
    const h = await harness();
    const provider = new FakeProvider([
      textTurn("pricey", { inputTokens: 2_000_000, outputTokens: 1_000_000 }),
    ]);
    await expect(
      runLoop({
        ...loopDefaults(h),
        provider,
        messages: [],
        maxRunCostUsd: 1,
        pricing: { input: 3, output: 15 },
      }),
    ).rejects.toThrow("The run reached its $1.00 estimated cost budget.");
  });

  test("research dispatch rejects unavailable tools", async () => {
    const h = await harness("research");
    const call: ToolCall = {
      id: "c1",
      name: "write_file",
      arguments: '{"path":"blocked.txt","content":"no"}',
    };
    const messages: AgentMessage[] = [];
    const output = await h.runner.execute(
      messages,
      h.checkpoint,
      h.mailbox,
      call,
    );
    expect(output).toContain("unavailable in this mode");
    expect(existsSync(path.join(h.dir, "blocked.txt"))).toBe(false);
  });

  test("mcp calls are rejected in research mode", async () => {
    const h = await harness("research");
    const output = await h.runner.execute([], h.checkpoint, h.mailbox, {
      id: "c1",
      name: "mcp__db__query",
      arguments: "{}",
    });
    expect(output).toBe(
      "Error: external MCP tools are unavailable in Deep Research mode.",
    );
  });

  test("unknown tools report the exact sentence", async () => {
    const h = await harness();
    const output = await h.runner.execute([], h.checkpoint, h.mailbox, {
      id: "c1",
      name: "made_up_tool",
      arguments: "{}",
    });
    expect(output).toBe('Error: unknown tool "made_up_tool".');
  });
});

describe("runSubagentLoop", () => {
  test("runs a read-only tool then answers", async () => {
    const h = await harness();
    const provider = new FakeProvider([
      toolTurn("s1", "git_status", "{}"),
      textTurn("Found three modules."),
    ]);
    const answer = await runSubagentLoop(
      provider,
      rejectingFetch,
      new Toolbox(h.dir),
      h.emitter,
      "parent-call",
      [{ type: "user", text: "map the modules" }],
      new AbortController().signal,
    );
    expect(answer).toBe("Found three modules.");
    expect(h.eventNames()).toContain("subagent_step");
  });

  test("rejects a mutating tool and stays read-only", async () => {
    const h = await harness();
    const provider = new FakeProvider([
      toolTurn("s1", "write_file", '{"path":"x.txt","content":"nope"}'),
      textTurn("done"),
    ]);
    const answer = await runSubagentLoop(
      provider,
      rejectingFetch,
      new Toolbox(h.dir),
      h.emitter,
      "parent-call",
      [{ type: "user", text: "try to write" }],
      new AbortController().signal,
    );
    expect(answer).toBe("done");
    expect(existsSync(path.join(h.dir, "x.txt"))).toBe(false);
    expect(
      provider.outputs.some(([, output]) => output.includes("read-only")),
    ).toBe(true);
  });

  test("step limit produces the partial-answer suffix", async () => {
    const h = await harness();
    const turns: Turn[] = [];
    for (let i = 0; i < 12; i += 1) {
      turns.push({
        texts: ["partial finding"],
        toolCalls: [{ id: `s${i}`, name: "git_status", arguments: "{}" }],
        usage: usage0,
      });
    }
    const answer = await runSubagentLoop(
      new FakeProvider(turns),
      rejectingFetch,
      new Toolbox(h.dir),
      h.emitter,
      "parent-call",
      [{ type: "user", text: "investigate forever" }],
      new AbortController().signal,
    );
    expect(answer).toBe(
      "partial finding\n\n(The sub-agent stopped at its step limit; this may be partial.)",
    );
  });
});
