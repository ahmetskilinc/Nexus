import { describe, expect, test } from "bun:test";
import { parseRuntimeEvent } from "./events";

describe("parseRuntimeEvent", () => {
  test("accepts every well-formed event variant", () => {
    const events = [
      { type: "assistant_text", text: "hi" },
      {
        type: "tool_call",
        id: "1",
        name: "read_file",
        summary: "Read a",
        arguments: "{}",
      },
      { type: "tool_result", id: "1", name: "read_file", preview: "ok" },
      { type: "command_output", callId: "c", stream: "stderr", chunk: "x" },
      { type: "command_end", callId: "c", exitCode: 0, timedOut: false },
      {
        type: "user_question",
        callId: "c",
        question: "Which database should I use?",
        choices: ["PostgreSQL", "SQLite"],
        allowFreeform: true,
      },
      { type: "plan", title: "T", markdown: "# t" },
      { type: "research", title: "T", markdown: "# t" },
      { type: "todos", todos: [{ content: "a", status: "pending" }] },
      { type: "compacted", removedMessages: 4, keptMessages: 6, summary: "s" },
      { type: "context", usedTokens: 12_400, contextTokens: 200_000 },
      { type: "subagent_step", callId: "c", tool: "grep", summary: "Grep x" },
      { type: "authorize_url", url: "https://auth.example" },
    ];
    for (const event of events) {
      expect(parseRuntimeEvent(event)).toEqual(event as never);
    }
  });

  test("accepts all three approval_request kinds", () => {
    expect(
      parseRuntimeEvent({
        type: "approval_request",
        kind: "edit",
        callId: "c",
        tool: "edit_file",
        path: "a.txt",
        before: "old",
        after: "new",
      }),
    ).toMatchObject({ kind: "edit", after: "new" });
    // Missing `after` (deletion / forward-compat) normalizes to null.
    expect(
      parseRuntimeEvent({
        type: "approval_request",
        kind: "edit",
        callId: "c",
        tool: "delete_file",
        path: "a.txt",
        before: "old",
      }),
    ).toMatchObject({ kind: "edit", after: null });
    expect(
      parseRuntimeEvent({
        type: "approval_request",
        kind: "command",
        callId: "c",
        tool: "run_command",
        command: "ls",
      }),
    ).toMatchObject({ kind: "command", command: "ls" });
    expect(
      parseRuntimeEvent({
        type: "approval_request",
        kind: "mcp",
        callId: "c",
        tool: "mcp__db__query",
        arguments: "{}",
      }),
    ).toMatchObject({ kind: "mcp" });
  });

  test("user questions default freeform and reject blank fields", () => {
    expect(
      parseRuntimeEvent({
        type: "user_question",
        callId: "c",
        question: "Continue?",
      }),
    ).toEqual({
      type: "user_question",
      callId: "c",
      question: "Continue?",
      allowFreeform: true,
    });
    expect(
      parseRuntimeEvent({
        type: "user_question",
        callId: "",
        question: "Continue?",
      }),
    ).toBeUndefined();
  });

  test("todos tolerance: bad statuses default, malformed items drop", () => {
    const parsed = parseRuntimeEvent({
      type: "todos",
      todos: [
        { content: "ok", status: "in_progress" },
        { content: "weird", status: "someday" },
        { status: "pending" },
        "garbage",
      ],
    });
    expect(parsed).toEqual({
      type: "todos",
      todos: [
        { content: "ok", status: "in_progress" },
        { content: "weird", status: "pending" },
      ],
    });
  });

  test("command_output stream falls back to stdout", () => {
    expect(
      parseRuntimeEvent({
        type: "command_output",
        callId: "c",
        stream: "somewhere",
        chunk: "x",
      }),
    ).toMatchObject({ stream: "stdout" });
  });

  test("unknown or malformed events are dropped", () => {
    expect(parseRuntimeEvent({ type: "brand_new_event" })).toBeUndefined();
    expect(parseRuntimeEvent({ type: "assistant_text" })).toBeUndefined();
    expect(parseRuntimeEvent(null)).toBeUndefined();
    expect(parseRuntimeEvent("text")).toBeUndefined();
  });

  test("extra fields are ignored (todos carries a callId on the wire)", () => {
    expect(
      parseRuntimeEvent({
        type: "todos",
        callId: "c",
        todos: [],
      }),
    ).toEqual({ type: "todos", todos: [] });
  });
});
