import { describe, expect, test } from "bun:test";
import { collectingEmitter } from "@nexus/protocol";
import { parseApprovalMode, requiresApproval, toolMode } from "./modes";
import { planTool, researchTool, todoTool } from "./ui-tools";

describe("approval modes", () => {
  test("parse and gate like the Rust enum", () => {
    expect(parseApprovalMode("plan")).toBe("plan");
    expect(parseApprovalMode("research")).toBe("research");
    expect(parseApprovalMode("ask")).toBe("ask");
    expect(parseApprovalMode("bogus")).toBe("auto");
    // Plan mode still requires per-change approval, like Ask. Research has
    // no mutating schemas but remains fail-closed if one is attempted.
    expect(requiresApproval("plan")).toBe(true);
    expect(requiresApproval("research")).toBe(true);
    expect(requiresApproval("ask")).toBe(true);
    expect(requiresApproval("auto")).toBe(false);
    expect(toolMode("plan")).toBe("plan");
    expect(toolMode("ask")).toBe("standard");
  });
});

describe("todoTool", () => {
  test("emits todos and renders the checklist", () => {
    const emitter = collectingEmitter();
    const out = todoTool(
      emitter,
      "c1",
      '{"todos":[{"content":"a","status":"in_progress"},{"content":"b","status":"weird"},{"status":"pending"}]}',
    );
    expect(out).toBe("Task list updated:\n[~] a\n[ ] b");
    expect(emitter.events[0]).toEqual({
      type: "todos",
      todos: [
        { content: "a", status: "in_progress" },
        { content: "b", status: "pending" },
      ],
    });
  });

  test("rejects non-array todos and renders empty lists", () => {
    const emitter = collectingEmitter();
    expect(todoTool(emitter, "c1", '{"todos": "nope"}')).toBe(
      'Error: "todos" must be an array.',
    );
    expect(todoTool(emitter, "c1", '{"todos": []}')).toBe(
      "The task list is empty.",
    );
  });
});

describe("planTool", () => {
  test("emits a plan event and requires markdown", () => {
    const emitter = collectingEmitter();
    const out = planTool(
      emitter,
      "call-1",
      '{"title": "Add X", "markdown": "# Plan\\ndo the thing"}',
    );
    expect(out).toContain("todo_write");
    expect(emitter.events[0]).toEqual({
      type: "plan",
      title: "Add X",
      markdown: "# Plan\ndo the thing",
    });
    // Missing/empty markdown is rejected and emits nothing.
    const before = emitter.events.length;
    expect(
      planTool(emitter, "call-2", '{"title": "x"}').startsWith("Error"),
    ).toBe(true);
    expect(emitter.events).toHaveLength(before);
  });
});

describe("researchTool", () => {
  test("emits a research event and requires markdown", () => {
    const emitter = collectingEmitter();
    const out = researchTool(
      emitter,
      "call-1",
      '{"title": "Auth flow", "markdown": "# Findings\\nSee `src/auth.rs`."}',
    );
    expect(out).toContain("Stop now");
    expect(emitter.events[0]).toEqual({
      type: "research",
      title: "Auth flow",
      markdown: "# Findings\nSee `src/auth.rs`.",
    });
    const before = emitter.events.length;
    expect(
      researchTool(emitter, "call-2", '{"title": "x"}').startsWith("Error"),
    ).toBe(true);
    expect(emitter.events).toHaveLength(before);
  });
});
