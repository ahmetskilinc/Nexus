import { describe, expect, test } from "bun:test";
import type {
  AppState,
  ModelsEntry,
  RuntimeEvent,
  Session,
} from "@nexus/protocol";
import {
  addChangedFiles,
  appendItem,
  applyCompaction,
  applyEvent,
  dedupeAttachments,
  finishRun,
  foldAttachments,
  groupSessions,
  mutationPaths,
  resolveEffort,
  resolveEffortOptions,
  updateSession,
} from "./session";

const NOW = "2026-07-16T12:00:00.000Z";
const LATER = "2026-07-16T12:05:00.000Z";

function session(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    title: "Task",
    createdAt: NOW,
    updatedAt: NOW,
    workspacePath: "/repo",
    transcript: [],
    history: [],
    ...overrides,
  };
}

function state(overrides: Partial<AppState> = {}): AppState {
  return {
    version: 1,
    providers: [],
    sessions: [session("a"), session("b")],
    currentSessionId: "b",
    ...overrides,
  };
}

function transcript(appState: AppState, sessionId: string) {
  const found = appState.sessions.find((item) => item.id === sessionId);
  if (!found) throw new Error(`missing session ${sessionId}`);
  return found.transcript;
}

describe("applyEvent", () => {
  const text: RuntimeEvent = { type: "assistant_text", text: "hello" };

  test("writes to the passed session, not the current one", () => {
    // Bug-1 regression: the user is viewing session b while a's run streams.
    const next = applyEvent(state(), "a", text, "item-1", LATER);
    expect(transcript(next, "a")).toHaveLength(1);
    expect(transcript(next, "a")[0]?.detail).toBe("hello");
    expect(transcript(next, "b")).toHaveLength(0);
  });

  test("unknown session id is a no-op", () => {
    const before = state();
    expect(applyEvent(before, "ghost", text, "item-1", LATER)).toEqual(before);
  });

  test("assistant_text coalesces into a trailing assistant item", () => {
    const first = applyEvent(state(), "a", text, "item-1", LATER);
    const second = applyEvent(
      first,
      "a",
      { type: "assistant_text", text: " world" },
      "item-2",
      LATER,
    );
    expect(transcript(second, "a")).toHaveLength(1);
    expect(transcript(second, "a")[0]?.detail).toBe("hello world");
  });

  test("assistant_text appends a new item after a non-assistant item", () => {
    const withTool = applyEvent(
      state(),
      "a",
      {
        type: "tool_call",
        id: "call-1",
        name: "read_file",
        summary: "Read a file",
        arguments: "{}",
      },
      "item-1",
      LATER,
    );
    const next = applyEvent(withTool, "a", text, "item-2", LATER);
    expect(transcript(next, "a")).toHaveLength(2);
    expect(transcript(next, "a")[1]?.kind).toBe("assistant");
  });

  test("agent_queued adds an informational queue marker", () => {
    const next = applyEvent(
      state(),
      "a",
      { type: "agent_queued" },
      "item-1",
      LATER,
    );
    expect(transcript(next, "a")[0]).toMatchObject({
      kind: "info",
      title: "Queued",
    });
  });

  test("provider_retry adds an informational recovery marker", () => {
    const next = applyEvent(
      state(),
      "a",
      {
        type: "provider_retry",
        attempt: 1,
        delayMs: 500,
        reason: "Provider temporarily unavailable (HTTP 429)",
      },
      "item-1",
      LATER,
    );
    expect(transcript(next, "a")[0]).toMatchObject({
      kind: "info",
      title: "Retrying provider (1)",
      detail: "Provider temporarily unavailable (HTTP 429). Retrying in 1s.",
    });
  });

  test("tool_result matches by toolCallId and fills result", () => {
    const withTool = applyEvent(
      state(),
      "a",
      {
        type: "tool_call",
        id: "call-1",
        name: "read_file",
        summary: "Read a file",
        arguments: "{}",
      },
      "item-1",
      LATER,
    );
    const next = applyEvent(
      withTool,
      "a",
      { type: "tool_result", id: "call-1", name: "read_file", preview: "ok" },
      "item-2",
      LATER,
    );
    expect(transcript(next, "a")[0]?.result).toBe("ok");
  });

  test("tool_result does not clobber run_command's streamed output", () => {
    let appState = applyEvent(
      state(),
      "a",
      {
        type: "tool_call",
        id: "call-1",
        name: "run_command",
        summary: "Run a command",
        arguments: '{"command":"ls"}',
      },
      "item-1",
      LATER,
    );
    appState = applyEvent(
      appState,
      "a",
      {
        type: "command_output",
        callId: "call-1",
        stream: "stdout",
        chunk: "x",
      },
      "item-2",
      LATER,
    );
    const next = applyEvent(
      appState,
      "a",
      {
        type: "tool_result",
        id: "call-1",
        name: "run_command",
        preview: "short",
      },
      "item-3",
      LATER,
    );
    expect(transcript(next, "a")[0]?.result).toBe("x\n");
  });

  test("command_output accumulates and marks running; command_end finalizes", () => {
    let appState = applyEvent(
      state(),
      "a",
      {
        type: "tool_call",
        id: "call-1",
        name: "run_command",
        summary: "Run a command",
        arguments: '{"command":"ls"}',
      },
      "item-1",
      LATER,
    );
    appState = applyEvent(
      appState,
      "a",
      {
        type: "command_output",
        callId: "call-1",
        stream: "stdout",
        chunk: "one",
      },
      "item-2",
      LATER,
    );
    appState = applyEvent(
      appState,
      "a",
      {
        type: "command_output",
        callId: "call-1",
        stream: "stderr",
        chunk: "two",
      },
      "item-3",
      LATER,
    );
    expect(transcript(appState, "a")[0]?.result).toBe("one\ntwo\n");
    expect(transcript(appState, "a")[0]?.running).toBe(true);
    const done = applyEvent(
      appState,
      "a",
      { type: "command_end", callId: "call-1", exitCode: 0, timedOut: false },
      "item-4",
      LATER,
    );
    expect(transcript(done, "a")[0]?.running).toBe(false);
    expect(transcript(done, "a")[0]?.exitCode).toBe(0);
  });

  function planOf(appState: AppState, id: string) {
    return appState.sessions.find((item) => item.id === id)?.plan;
  }

  test("plan event sets the session plan", () => {
    const next = applyEvent(
      state(),
      "a",
      { type: "plan", title: "Add X", markdown: "# Plan" },
      "item-1",
      LATER,
    );
    expect(planOf(next, "a")).toEqual({
      title: "Add X",
      markdown: "# Plan",
      todos: [],
      updatedAt: LATER,
    });
  });

  test("research event sets only the owning session report", () => {
    const next = applyEvent(
      state(),
      "a",
      {
        type: "research",
        title: "Authentication flow",
        markdown: "# Findings",
      },
      "item-1",
      LATER,
    );
    expect(next.sessions.find((item) => item.id === "a")?.research).toEqual({
      title: "Authentication flow",
      markdown: "# Findings",
      updatedAt: LATER,
    });
    expect(
      next.sessions.find((item) => item.id === "b")?.research,
    ).toBeUndefined();
  });

  test("todos event updates the plan checklist once a plan exists", () => {
    const withPlan = applyEvent(
      state(),
      "a",
      { type: "plan", title: "Add X", markdown: "# Plan" },
      "item-1",
      LATER,
    );
    const next = applyEvent(
      withPlan,
      "a",
      {
        type: "todos",
        todos: [{ content: "Step 1", status: "in_progress" }],
      },
      "item-2",
      LATER,
    );
    expect(planOf(next, "a")?.todos).toEqual([
      { content: "Step 1", status: "in_progress" },
    ]);
  });

  test("todos event without a plan is a no-op", () => {
    const before = state();
    const next = applyEvent(
      before,
      "a",
      { type: "todos", todos: [{ content: "Step 1", status: "pending" }] },
      "item-1",
      LATER,
    );
    expect(next).toEqual(before);
    expect(planOf(next, "a")).toBeUndefined();
  });

  test("subagent_step appends a labeled step to its parent tool item", () => {
    const withSpawn = applyEvent(
      state(),
      "a",
      {
        type: "tool_call",
        id: "spawn-1",
        name: "spawn_agent",
        summary: "Research auth",
        arguments: '{"task":"trace auth"}',
      },
      "item-1",
      LATER,
    );
    const next = applyEvent(
      withSpawn,
      "a",
      {
        type: "subagent_step",
        callId: "spawn-1",
        tool: "read_file",
        summary: "src/auth.ts",
      },
      "item-2",
      LATER,
    );
    const item = transcript(next, "a")[0];
    expect(item?.subagentSteps).toEqual(["read_file src/auth.ts"]);
    // A step for an unknown call id changes nothing.
    const unchanged = applyEvent(
      next,
      "a",
      { type: "subagent_step", callId: "ghost", tool: "grep", summary: "x" },
      "item-3",
      LATER,
    );
    expect(transcript(unchanged, "a")[0]?.subagentSteps).toEqual([
      "read_file src/auth.ts",
    ]);
  });

  test("compacted event appends an info marker with the summary", () => {
    const next = applyEvent(
      state(),
      "a",
      {
        type: "compacted",
        removedMessages: 12,
        keptMessages: 6,
        summary: "The user was refactoring auth.",
      },
      "item-1",
      LATER,
    );
    const item = transcript(next, "a")[0];
    expect(item?.kind).toBe("info");
    expect(item?.title).toBe("Context compacted");
    expect(item?.detail).toContain("12");
    expect(item?.result).toBe("The user was refactoring auth.");
  });
});

describe("finishRun", () => {
  test("replaces history on the passed session", () => {
    const result = {
      messages: [{ type: "user", text: "hi" }],
      openAIResponseId: "resp-1",
    };
    const next = finishRun(state(), "a", result, LATER);
    const updated = next.sessions.find((item) => item.id === "a");
    expect(updated?.history).toEqual([{ type: "user", text: "hi" }]);
    expect(updated?.openAIResponseId).toBe("resp-1");
    expect(updated?.updatedAt).toBe(LATER);
    // The viewed session is untouched.
    expect(next.sessions.find((item) => item.id === "b")?.history).toEqual([]);
  });

  test("unknown session id is a no-op", () => {
    const before = state();
    expect(finishRun(before, "ghost", { messages: [] }, LATER)).toEqual(before);
  });

  test("usage and cost accumulate across runs", () => {
    const first = finishRun(
      state(),
      "a",
      {
        messages: [],
        usage: { inputTokens: 100, outputTokens: 20 },
        costUsd: 0.05,
      },
      LATER,
    );
    const second = finishRun(
      first,
      "a",
      {
        messages: [],
        usage: { inputTokens: 300, outputTokens: 50 },
        costUsd: 0.15,
      },
      LATER,
    );
    const updated = second.sessions.find((item) => item.id === "a");
    expect(updated?.usage).toEqual({ inputTokens: 400, outputTokens: 70 });
    expect(updated?.costUsd).toBeCloseTo(0.2);
  });

  test("a run without usage leaves the meter untouched", () => {
    const seeded = finishRun(
      state(),
      "a",
      {
        messages: [],
        usage: { inputTokens: 10, outputTokens: 5 },
        costUsd: 0.01,
      },
      LATER,
    );
    // Older runtime / null cost: nothing changes.
    const next = finishRun(seeded, "a", { messages: [], costUsd: null }, LATER);
    const updated = next.sessions.find((item) => item.id === "a");
    expect(updated?.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(updated?.costUsd).toBeCloseTo(0.01);
  });

  test("finishRun clears the active-run recovery marker", () => {
    const input = state({
      sessions: [
        session("a", {
          recovery: { runId: "run-1", startedAt: NOW, status: "in_progress" },
        }),
        session("b"),
      ],
    });
    const next = finishRun(input, "a", { messages: [] }, LATER);
    expect(next.sessions[0]?.recovery).toBeUndefined();
    expect(next.sessions[0]?.runJournal).toEqual([
      { id: "run-1", startedAt: NOW, endedAt: LATER, status: "completed" },
    ]);
  });
});

describe("groupSessions", () => {
  test("pinned sessions lead their group; recency orders within each half", () => {
    const appState = state({
      workspacePath: "/repo",
      sessions: [
        { ...session("old"), updatedAt: NOW },
        { ...session("new"), updatedAt: LATER },
        { ...session("pinned-old"), updatedAt: NOW, pinned: true },
      ],
    });
    const groups = groupSessions(appState);
    const repo = groups.find((group) => group.workspace.path === "/repo");
    expect(repo?.sessions.map((item) => item.id)).toEqual([
      "pinned-old",
      "new",
      "old",
    ]);
  });
});

describe("resolveEffortOptions / resolveEffort", () => {
  function modelState(overrides: Partial<AppState> = {}): AppState {
    return state({
      providers: [
        { id: "p1", name: "OpenAI", kind: "OpenAI", authentication: "api_key" },
      ],
      selectedProviderId: "p1",
      selectedModel: "gpt-5-codex",
      ...overrides,
    });
  }
  const loaded: Record<string, ModelsEntry> = {
    p1: {
      loading: false,
      models: [
        {
          id: "gpt-5-codex",
          name: "GPT-5 Codex",
          reasoning: true,
          effort: ["low", "medium", "high"],
        },
      ],
    },
  };

  test("uses the loaded catalog entry when present", () => {
    expect(resolveEffortOptions(modelState(), undefined, loaded)).toEqual([
      "low",
      "medium",
      "high",
    ]);
  });

  test("falls back to the name heuristic before the catalog arrives", () => {
    // gpt-5-codex heuristic: minimal..xhigh (lib/capabilities mirror).
    expect(resolveEffortOptions(modelState(), undefined, {})).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
  });

  test("empty when the provider or model is unresolved", () => {
    expect(
      resolveEffortOptions(
        modelState({ selectedModel: undefined }),
        undefined,
        {},
      ),
    ).toEqual([]);
    expect(
      resolveEffortOptions(modelState({ providers: [] }), undefined, {}),
    ).toEqual([]);
  });

  test("resolveEffort clamps a persisted xhigh on a low-ceiling model", () => {
    // gpt-5 (non-codex) tops out at high in the heuristic mirror.
    const appState = modelState({
      selectedModel: "gpt-5",
      selectedEffort: "xhigh",
    });
    expect(resolveEffort(undefined, appState)).toBe("high");
  });
});

describe("appendItem / updateSession", () => {
  test("appendItem adds to the passed session and bumps updatedAt", () => {
    const next = appendItem(
      state(),
      "a",
      { id: "item-1", kind: "info", title: "Stopped", detail: "cancelled" },
      LATER,
    );
    expect(transcript(next, "a")).toHaveLength(1);
    expect(next.sessions.find((item) => item.id === "a")?.updatedAt).toBe(
      LATER,
    );
  });

  test("updateSession maps only the matching session", () => {
    const next = updateSession(state(), "a", (item) => ({
      ...item,
      title: "Renamed",
    }));
    expect(next.sessions.find((item) => item.id === "a")?.title).toBe(
      "Renamed",
    );
    expect(next.sessions.find((item) => item.id === "b")?.title).toBe("Task");
  });
});

describe("attachments (@-mentions)", () => {
  test("dedupeAttachments trims, drops blanks, keeps first-seen order", () => {
    expect(
      dedupeAttachments(["  a.ts ", "b.ts", "a.ts", "", "   ", "c.ts"]),
    ).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  test("foldAttachments appends an Attached files block after the text", () => {
    const folded = foldAttachments("look at these", ["src/a.ts", "src/b.ts"]);
    expect(folded).toBe(
      "look at these\n\n" +
        "Attached files (read them with read_file if relevant):\n" +
        "- src/a.ts\n- src/b.ts",
    );
  });

  test("foldAttachments with no attachments returns the text unchanged", () => {
    expect(foldAttachments("hello", [])).toBe("hello");
  });

  test("foldAttachments with empty text yields just the block", () => {
    expect(foldAttachments("", ["src/a.ts"])).toBe(
      "Attached files (read them with read_file if relevant):\n- src/a.ts",
    );
  });
});

describe("changedFiles accumulation", () => {
  test("mutationPaths extracts paths only for mutating tools", () => {
    expect(mutationPaths("edit_file", '{"path":"src/a.ts"}')).toEqual([
      "src/a.ts",
    ]);
    expect(mutationPaths("write_file", '{"path":"b.ts"}')).toEqual(["b.ts"]);
    expect(
      mutationPaths("rename_file", '{"from":"old.ts","to":"new.ts"}'),
    ).toEqual(["old.ts", "new.ts"]);
    // Non-mutating tools contribute nothing.
    expect(mutationPaths("read_file", '{"path":"a.ts"}')).toEqual([]);
    expect(mutationPaths("run_command", '{"command":"ls"}')).toEqual([]);
    // Malformed args don't throw.
    expect(mutationPaths("edit_file", "not json")).toEqual([]);
  });

  test("addChangedFiles dedupes and preserves first-seen order", () => {
    expect(addChangedFiles(["a.ts"], ["b.ts", "a.ts", "c.ts"])).toEqual([
      "a.ts",
      "b.ts",
      "c.ts",
    ]);
    // Nothing to add returns a defined array without mutating the original.
    expect(addChangedFiles(undefined, [])).toEqual([]);
    expect(addChangedFiles(["a.ts"], [])).toEqual(["a.ts"]);
  });

  test("a mutation tool_call records the path on the session", () => {
    const call: RuntimeEvent = {
      type: "tool_call",
      id: "c1",
      name: "edit_file",
      summary: "Edit src/a.ts",
      arguments: '{"path":"src/a.ts"}',
    };
    const next = applyEvent(state(), "a", call, "item-1", LATER);
    const target = next.sessions.find((item) => item.id === "a");
    expect(target?.changedFiles).toEqual(["src/a.ts"]);
    // The transcript item is still appended.
    expect(target?.transcript).toHaveLength(1);
    // A read_file call adds nothing to the change set.
    const after = applyEvent(
      next,
      "a",
      {
        type: "tool_call",
        id: "c2",
        name: "read_file",
        summary: "Read src/a.ts",
        arguments: '{"path":"src/a.ts"}',
      },
      "item-2",
      LATER,
    );
    expect(
      after.sessions.find((item) => item.id === "a")?.changedFiles,
    ).toEqual(["src/a.ts"]);
  });
});

describe("context meter", () => {
  const reading: RuntimeEvent = {
    type: "context",
    usedTokens: 124_800,
    contextTokens: 200_000,
  };

  test("a context event records the reading on its session", () => {
    const next = applyEvent(state(), "a", reading, "item-1", LATER);
    expect(next.sessions.find((item) => item.id === "a")?.context).toEqual({
      usedTokens: 124_800,
      contextTokens: 200_000,
    });
    // It is a reading, not a transcript entry.
    expect(transcript(next, "a")).toHaveLength(0);
  });

  test("each reading replaces the last rather than accumulating", () => {
    const first = applyEvent(state(), "a", reading, "item-1", LATER);
    const second = applyEvent(
      first,
      "a",
      { type: "context", usedTokens: 8_000, contextTokens: 200_000 },
      "item-2",
      LATER,
    );
    expect(
      second.sessions.find((item) => item.id === "a")?.context?.usedTokens,
    ).toBe(8_000);
  });
});

describe("applyCompaction", () => {
  const folded = [{ type: "user", text: "Summary of the conversation…" }];
  const result = {
    messages: folded,
    summary: "We built the thing.",
    removedMessages: 12,
    keptMessages: 4,
    usedTokens: 900,
    contextTokens: 200_000,
  };

  function compacted() {
    const before = state({
      sessions: [
        session("a", {
          history: [{ type: "user", text: "old" }],
          openAIResponseId: "resp-1",
        }),
        session("b"),
      ],
    });
    return applyCompaction(before, "a", result, "item-1", LATER);
  }

  test("swaps in the folded history and marks the transcript", () => {
    const updated = compacted().sessions.find((item) => item.id === "a");
    expect(updated?.history).toEqual(folded as Session["history"]);
    expect(updated?.transcript).toHaveLength(1);
    expect(updated?.transcript[0]?.title).toBe("Context compacted");
    expect(updated?.transcript[0]?.detail).toContain("12 earlier messages");
    expect(updated?.transcript[0]?.result).toBe("We built the thing.");
    expect(updated?.updatedAt).toBe(LATER);
  });

  test("drops the OpenAI chain, which no longer matches the history", () => {
    expect(
      compacted().sessions.find((item) => item.id === "a")?.openAIResponseId,
    ).toBeUndefined();
  });

  test("the meter drops immediately, flagged as an estimate", () => {
    expect(
      compacted().sessions.find((item) => item.id === "a")?.context,
    ).toEqual({ usedTokens: 900, contextTokens: 200_000, estimated: true });
  });

  test("nothing to compact leaves the state untouched", () => {
    const before = state();
    expect(
      applyCompaction(before, "a", { messages: null }, "item-1", LATER),
    ).toEqual(before);
  });
});
