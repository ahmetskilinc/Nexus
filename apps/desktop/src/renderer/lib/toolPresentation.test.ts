import { describe, expect, test } from "bun:test";
import type { TranscriptItem } from "@nexus/protocol";
import {
  approvalToolLabel,
  commandFromArgs,
  commandProgram,
  describeToolCall,
  parseJsonArgs,
  parseTodos,
  toolOwnsStreamedResult,
} from "./toolPresentation";

function item(title: string, args?: string): TranscriptItem {
  return { id: "i1", kind: "tool", title, detail: "", args };
}

describe("describeToolCall", () => {
  test("read_file renders path and line-range meta", () => {
    const p = describeToolCall(
      item("read_file", '{"path":"src/main.rs","start_line":2,"end_line":9}'),
    );
    expect(p.verb).toBe("Read");
    expect(p.target).toBe("src/main.rs");
    expect(p.meta).toBe("L2–9");
    expect(p.card).toBe("generic");
    expect(p.bodyKind).toBe("content");
  });

  test("grep and glob show pattern with scope meta", () => {
    const grep = describeToolCall(
      item("grep", '{"pattern":"TODO","path":"src"}'),
    );
    expect(grep.target).toBe("TODO");
    expect(grep.meta).toBe("in src");
    const glob = describeToolCall(item("glob", '{"pattern":"**/*.rs"}'));
    expect(glob.verb).toBe("Find files");
    expect(glob.target).toBe("**/*.rs");
    expect(glob.meta).toBeUndefined();
  });

  test("mcp__server__tool splits into verb + via-server meta", () => {
    const p = describeToolCall(item("mcp__files__search_notes", "{}"));
    expect(p.verb).toBe("search_notes");
    expect(p.meta).toBe("via files");
  });

  test("unknown tools fall back to underscores-to-spaces", () => {
    const p = describeToolCall(item("frobnicate_widget", "{}"));
    expect(p.verb).toBe("frobnicate widget");
    expect(p.card).toBe("generic");
  });

  test("run_command and todo_write route to their own cards", () => {
    expect(describeToolCall(item("run_command", '{"command":"ls"}')).card).toBe(
      "command",
    );
    expect(describeToolCall(item("todo_write", '{"todos":[]}')).card).toBe(
      "todo",
    );
  });

  test("edits are status-bodied; reads are content-bodied", () => {
    expect(
      describeToolCall(
        item("edit_file", '{"path":"a.ts","old_string":"x","new_string":"y"}'),
      ).bodyKind,
    ).toBe("status");
    expect(describeToolCall(item("git_status", "{}")).bodyKind).toBe("content");
  });
});

describe("argument parsers tolerate malformed input", () => {
  test("parseJsonArgs", () => {
    expect(parseJsonArgs(undefined)).toEqual({});
    expect(parseJsonArgs("not json")).toEqual({});
    expect(parseJsonArgs('"a string"')).toEqual({});
    expect(parseJsonArgs('{"a":1}')).toEqual({ a: 1 });
  });

  test("parseTodos filters wrong shapes", () => {
    expect(parseTodos(undefined)).toEqual([]);
    expect(parseTodos('{"todos":"nope"}')).toEqual([]);
    expect(
      parseTodos(
        '{"todos":[{"content":"a","status":"pending"},{"content":1,"status":"pending"},{"content":"b","status":"bogus"}]}',
      ),
    ).toEqual([{ content: "a", status: "pending" }]);
  });

  test("commandFromArgs", () => {
    expect(commandFromArgs('{"command":"cargo test"}')).toBe("cargo test");
    expect(commandFromArgs("garbage")).toBe("");
    expect(commandFromArgs(undefined)).toBe("");
  });
});

describe("commandProgram", () => {
  test("takes the first whitespace-delimited token", () => {
    expect(commandProgram("npm run build")).toBe("npm");
    expect(commandProgram("  cargo   test ")).toBe("cargo");
    expect(commandProgram("")).toBe("");
  });
});

describe("approvalToolLabel / toolOwnsStreamedResult", () => {
  test("labels cover the mutating tools and fall back to the name", () => {
    expect(approvalToolLabel("edit_file")).toBe("Edit");
    expect(approvalToolLabel("multi_edit")).toBe("Edit");
    expect(approvalToolLabel("rename_file")).toBe("Rename");
    expect(approvalToolLabel("run_command")).toBe("Run");
    expect(approvalToolLabel("mystery")).toBe("mystery");
  });

  test("only run_command owns its streamed result", () => {
    expect(toolOwnsStreamedResult("run_command")).toBe(true);
    expect(toolOwnsStreamedResult("read_file")).toBe(false);
  });
});
