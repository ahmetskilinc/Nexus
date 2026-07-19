import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@nexus/protocol";
import {
  estimateTokens,
  extractSummary,
  fold,
  olderMessages,
  shouldCompact,
  summaryInput,
  threshold,
} from "./compaction";

const user = (text: string): AgentMessage => ({ type: "user", text });
const assistant = (text: string): AgentMessage => ({
  type: "assistant_text",
  text,
});
const toolCall = (id: string): AgentMessage => ({
  type: "tool_call",
  id,
  name: "read_file",
  arguments: "{}",
});
const toolResult = (id: string): AgentMessage => ({
  type: "tool_result",
  id,
  name: "read_file",
  output: "contents",
});

describe("compaction", () => {
  test("estimate scales with content", () => {
    expect(estimateTokens([user("hi")])).toBe(0);
    expect(estimateTokens([user("x".repeat(4000))])).toBe(1000);
  });

  test("threshold uses the context window with a default", () => {
    expect(threshold(100_000)).toBe(70_000);
    expect(threshold(undefined)).toBe(140_000);
  });

  test("should_compact needs both size and length", () => {
    // Too short to compact regardless of size.
    const short = Array.from({ length: 4 }, () => user("x".repeat(1_000_000)));
    expect(shouldCompact(short, 1_000)).toBe(false);
    // Long and large enough.
    const long = Array.from({ length: 20 }, () => user("x".repeat(4000)));
    expect(shouldCompact(long, 10_000)).toBe(true);
    // Long but small.
    const small = Array.from({ length: 20 }, () => user("hi"));
    expect(shouldCompact(small, 10_000)).toBe(false);
  });

  test("split never starts inside a tool exchange", () => {
    const history: AgentMessage[] = [user("start")];
    for (let i = 0; i < 4; i += 1) {
      history.push(
        assistant("looking"),
        toolCall(`c${i}`),
        toolResult(`c${i}`),
      );
    }
    history.push(user("latest"));
    const compacted = fold(history, "s");
    if (!compacted) throw new Error("expected a fold");
    // The kept tail (after the summary head) starts on a user message.
    expect(compacted[1]?.type).toBe("user");
  });

  test("fold replaces older with summary and keeps the tail", () => {
    const history: AgentMessage[] = [user("original task")];
    for (let i = 0; i < 3; i += 1) {
      history.push(assistant(`step ${i}`), user(`next ${i}`));
    }
    history.push(user("final question"));
    const compacted = fold(history, "We did steps 0-2.");
    if (!compacted) throw new Error("expected a fold");
    const head = compacted[0];
    if (head?.type !== "user") throw new Error("summary head must be user");
    expect(head.text).toContain("Summary of the conversation");
    expect(head.text).toContain("We did steps 0-2.");
    expect(compacted.length).toBeLessThan(history.length);
    const last = compacted[compacted.length - 1];
    expect(last).toEqual(user("final question"));
  });

  test("fold returns undefined when nothing to compact", () => {
    expect(fold([user("only"), assistant("reply")], "summary")).toBeUndefined();
  });

  test("older and fold partition the history", () => {
    const history: AgentMessage[] = [user("a")];
    for (let i = 0; i < 3; i += 1) {
      history.push(assistant(`r${i}`), user(`u${i}`));
    }
    const older = olderMessages(history);
    const compacted = fold(history, "s");
    if (!older || !compacted) throw new Error("expected both");
    expect(compacted.length - 1).toBe(history.length - older.length);
  });

  test("summary input renders a transcript", () => {
    const text = summaryInput([
      user("add a route"),
      toolCall("c1"),
      toolResult("c1"),
      assistant("done"),
    ]);
    expect(text).toContain("User: add a route");
    expect(text).toContain("Assistant called read_file");
    expect(text).toContain("read_file returned: contents");
    expect(text).toContain("Assistant: done");
  });

  test("extract summary reads text blocks", () => {
    expect(
      extractSummary({
        content: [
          { type: "thinking", thinking: "..." },
          { type: "text", text: "the summary" },
        ],
      }),
    ).toBe("the summary");
    expect(extractSummary({ content: [] })).toBeUndefined();
    expect(extractSummary({})).toBeUndefined();
  });

  test("tool_result summary input caps at 500 code points", () => {
    const long: AgentMessage = {
      type: "tool_result",
      id: "c1",
      name: "read_file",
      output: "y".repeat(2000),
    };
    const line = summaryInput([long]);
    expect(line.length).toBeLessThanOrEqual(
      "read_file returned: ".length + 500,
    );
  });
});
