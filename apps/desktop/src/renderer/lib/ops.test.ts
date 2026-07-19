import { describe, expect, test } from "bun:test";
import type { AppState, ProviderProfile, Session } from "@nexus/protocol";
import {
  addMcpServer,
  addProvider,
  addSession,
  clearSessionEffort,
  closeSplitPane,
  deleteSession,
  deleteSessions,
  focusSession,
  markCheckpointFilesRestored,
  openSessionInSplit,
  openWorkspace,
  removeMcpServer,
  removeProvider,
  renameSession,
  selectEffort,
  selectModel,
  selectSession,
  setApprovalMode,
  setCommandEnvironment,
  setCustomInstructions,
  setSplitRatio,
  setTerminalShell,
  setTheme,
  setWebAccess,
  togglePinSession,
} from "./ops";

const NOW = "2026-07-16T12:00:00.000Z";
const LATER = "2026-07-16T12:05:00.000Z";

function provider(id: string): ProviderProfile {
  return { id, name: id, kind: "OpenAI", authentication: "api_key" };
}

function session(id: string, workspacePath = "/repo"): Session {
  return {
    id,
    title: "Task",
    createdAt: NOW,
    updatedAt: NOW,
    workspacePath,
    transcript: [],
    history: [],
  };
}

function state(overrides: Partial<AppState> = {}): AppState {
  return {
    version: 1,
    workspacePath: "/repo",
    providers: [provider("p1"), provider("p2")],
    selectedProviderId: "p1",
    sessions: [session("a"), session("b", "/other")],
    currentSessionId: "a",
    ...overrides,
  };
}

describe("provider ops", () => {
  test("addProvider appends and selects", () => {
    const next = addProvider(provider("p3"))(state());
    expect(next.providers.map((item) => item.id)).toEqual(["p1", "p2", "p3"]);
    expect(next.selectedProviderId).toBe("p3");
  });

  test("removing the selected provider selects the first survivor", () => {
    const next = removeProvider("p1")(state());
    expect(next.providers.map((item) => item.id)).toEqual(["p2"]);
    expect(next.selectedProviderId).toBe("p2");
  });

  test("removing a non-selected provider keeps the selection", () => {
    const next = removeProvider("p2")(state());
    expect(next.selectedProviderId).toBe("p1");
  });

  test("removing the last provider clears the selection", () => {
    const only = state({ providers: [provider("p1")] });
    const next = removeProvider("p1")(only);
    expect(next.providers).toEqual([]);
    expect(next.selectedProviderId).toBeUndefined();
  });
});

describe("session ops", () => {
  test("addSession appends and makes current", () => {
    const next = addSession(session("c"))(state());
    expect(next.sessions).toHaveLength(3);
    expect(next.currentSessionId).toBe("c");
  });

  test("openWorkspace switches path and adds the session", () => {
    const next = openWorkspace("/new", session("c", "/new"))(state());
    expect(next.workspacePath).toBe("/new");
    expect(next.currentSessionId).toBe("c");
  });

  test("selectSession follows the session to its workspace", () => {
    const next = selectSession("b")(state());
    expect(next.currentSessionId).toBe("b");
    expect(next.workspacePath).toBe("/other");
  });

  test("selectSession no-ops on unknown ids", () => {
    const before = state();
    expect(selectSession("ghost")(before)).toEqual(before);
  });

  test("setApprovalMode sets the mode and bumps updatedAt", () => {
    const auto = setApprovalMode("a", "auto", LATER)(state());
    const set = auto.sessions.find((item) => item.id === "a");
    expect(set?.approvalMode).toBe("auto");
    expect(set?.updatedAt).toBe(LATER);
    const research = setApprovalMode("a", "research", LATER)(auto);
    expect(
      research.sessions.find((item) => item.id === "a")?.approvalMode,
    ).toBe("research");
    const plan = setApprovalMode("a", "plan", LATER)(research);
    expect(plan.sessions.find((item) => item.id === "a")?.approvalMode).toBe(
      "plan",
    );
  });
});

describe("rename / pin / delete session ops", () => {
  test("renameSession retitles and bumps updatedAt", () => {
    const next = renameSession("a", "Fix the parser", LATER)(state());
    const renamed = next.sessions.find((item) => item.id === "a");
    expect(renamed?.title).toBe("Fix the parser");
    expect(renamed?.updatedAt).toBe(LATER);
  });

  test("togglePinSession flips pinned", () => {
    const pinned = togglePinSession("a")(state());
    expect(pinned.sessions.find((item) => item.id === "a")?.pinned).toBe(true);
    const unpinned = togglePinSession("a")(pinned);
    expect(unpinned.sessions.find((item) => item.id === "a")?.pinned).toBe(
      false,
    );
  });

  test("deleting a non-current session keeps the selection", () => {
    const next = deleteSession("b")(state());
    expect(next.sessions.map((item) => item.id)).toEqual(["a"]);
    expect(next.currentSessionId).toBe("a");
  });

  test("deleting the current session selects the same-workspace survivor", () => {
    const withThree = state({
      sessions: [
        session("a"),
        { ...session("b", "/other"), updatedAt: LATER },
        session("c"),
      ],
      currentSessionId: "a",
      workspacePath: "/repo",
    });
    const next = deleteSession("a")(withThree);
    // "c" shares /repo with the deleted session; "b" is more recent but in
    // another workspace.
    expect(next.currentSessionId).toBe("c");
    expect(next.workspacePath).toBe("/repo");
  });

  test("deleting the workspace's last session follows selection elsewhere", () => {
    const twoWorkspaces = state({
      sessions: [session("a"), session("b", "/other")],
      currentSessionId: "a",
      workspacePath: "/repo",
    });
    const next = deleteSession("a")(twoWorkspaces);
    expect(next.currentSessionId).toBe("b");
    expect(next.workspacePath).toBe("/other");
  });

  test("deleting the last session clears the selection", () => {
    const only = state({ sessions: [session("a")], currentSessionId: "a" });
    const next = deleteSession("a")(only);
    expect(next.sessions).toEqual([]);
    expect(next.currentSessionId).toBeUndefined();
    expect(next.workspacePath).toBe("/repo"); // workspace stays open
  });

  test("deleting an unknown session is a no-op", () => {
    const before = state();
    expect(deleteSession("ghost")(before)).toEqual(before);
  });

  test("deleteSessions removes several non-current sessions at once", () => {
    const many = state({
      sessions: [
        session("a"),
        session("b", "/other"),
        session("c"),
        session("d", "/other"),
      ],
      currentSessionId: "a",
    });
    const next = deleteSessions(["b", "d"])(many);
    expect(next.sessions.map((item) => item.id)).toEqual(["a", "c"]);
    expect(next.currentSessionId).toBe("a");
  });

  test("deleteSessions including the current session picks a survivor", () => {
    const many = state({
      sessions: [session("a"), session("b"), session("c", "/other")],
      currentSessionId: "a",
      workspacePath: "/repo",
    });
    const next = deleteSessions(["a", "c"])(many);
    // "a" (current) and "c" go; "b" survives in the same workspace.
    expect(next.sessions.map((item) => item.id)).toEqual(["b"]);
    expect(next.currentSessionId).toBe("b");
    expect(next.workspacePath).toBe("/repo");
  });

  test("deleteSessions ignores unknown ids", () => {
    const before = state();
    const next = deleteSessions(["ghost", "b"])(before);
    expect(next.sessions.map((item) => item.id)).toEqual(["a"]);
    expect(next.currentSessionId).toBe("a");
  });

  test("deleteSessions with an empty list is a no-op", () => {
    const before = state();
    expect(deleteSessions([])(before)).toEqual(before);
  });
});

describe("split-view ops", () => {
  test("setSplitRatio persists the divider position, clamped to 30–70%", () => {
    expect(setSplitRatio(0.42)(state()).splitRatio).toBe(0.42);
    expect(setSplitRatio(0.05)(state()).splitRatio).toBe(0.3);
    expect(setSplitRatio(0.95)(state()).splitRatio).toBe(0.7);
  });

  test("openSessionInSplit focuses the target on the requested side", () => {
    const next = openSessionInSplit("b", "left")(state());
    // "b" is focused (current) on the left; "a" becomes the unfocused pane on
    // the opposite side.
    expect(next.currentSessionId).toBe("b");
    expect(next.sideSessionId).toBe("a");
    expect(next.sidePosition).toBe("right");
    expect(next.workspacePath).toBe("/other"); // focus follows workspace
    const right = openSessionInSplit("b", "right")(state());
    expect(right.sidePosition).toBe("left");
  });

  test("openSessionInSplit no-ops for the focused session and unknown ids", () => {
    const before = state();
    expect(openSessionInSplit("a", "left")(before)).toEqual(before);
    expect(openSessionInSplit("ghost", "right")(before)).toEqual(before);
  });

  test("focusSession swaps roles without moving panes", () => {
    // "a" focused, "b" unfocused on the right → focusing "b" keeps "b" on the
    // right (roles swap, sidePosition flips to keep panes physically put).
    const split = state({ sideSessionId: "b", sidePosition: "right" });
    const next = focusSession("b")(split);
    expect(next.currentSessionId).toBe("b");
    expect(next.sideSessionId).toBe("a");
    expect(next.sidePosition).toBe("left");
    expect(next.workspacePath).toBe("/other");
    // Focusing anything but the side session no-ops.
    expect(focusSession("a")(split)).toEqual(split);
    expect(focusSession("ghost")(split)).toEqual(split);
  });

  test("selecting the other pane's session moves focus, panes stay", () => {
    const split = state({ sideSessionId: "b", sidePosition: "right" });
    const next = selectSession("b")(split);
    expect(next.currentSessionId).toBe("b");
    expect(next.sideSessionId).toBe("a");
    expect(next.sidePosition).toBe("left");
  });

  test("selecting a third session replaces the focused pane and keeps the split", () => {
    const split = state({
      sessions: [session("a"), session("b", "/other"), session("c")],
      sideSessionId: "b",
      sidePosition: "right",
    });
    const next = selectSession("c")(split);
    expect(next.currentSessionId).toBe("c");
    expect(next.sideSessionId).toBe("b");
    expect(next.sidePosition).toBe("right");
  });

  test("closeSplitPane keeps the survivor and focuses it", () => {
    const split = state({ sideSessionId: "b", sidePosition: "right" });
    // Closing the unfocused pane: focus stays on "a".
    const closedSide = closeSplitPane("b")(split);
    expect(closedSide.currentSessionId).toBe("a");
    expect(closedSide.sideSessionId).toBeUndefined();
    expect(closedSide.sidePosition).toBeUndefined();
    // Closing the focused pane: the side session takes over (+ workspace).
    const closedCurrent = closeSplitPane("a")(split);
    expect(closedCurrent.currentSessionId).toBe("b");
    expect(closedCurrent.sideSessionId).toBeUndefined();
    expect(closedCurrent.workspacePath).toBe("/other");
    // Not split / unknown ids no-op.
    expect(closeSplitPane("a")(state())).toEqual(state());
  });

  test("deleting the unfocused pane's session collapses the split", () => {
    const split = state({ sideSessionId: "b", sidePosition: "left" });
    const next = deleteSession("b")(split);
    expect(next.sideSessionId).toBeUndefined();
    expect(next.sidePosition).toBeUndefined();
    expect(next.currentSessionId).toBe("a");
  });

  test("deleting the focused session hands the split survivor the focus", () => {
    const split = state({
      sessions: [session("a"), session("b", "/other"), session("c")],
      currentSessionId: "a",
      sideSessionId: "b",
      sidePosition: "right",
    });
    // "c" shares /repo and would win by recency — but the split survivor "b"
    // takes over instead, collapsing the split.
    const next = deleteSession("a")(split);
    expect(next.currentSessionId).toBe("b");
    expect(next.sideSessionId).toBeUndefined();
    expect(next.workspacePath).toBe("/other");
  });
});

describe("model / effort ops", () => {
  test("selectModel writes the global default and the session override", () => {
    const next = selectModel("a", "p2", "gpt-5")(state());
    expect(next.selectedProviderId).toBe("p2");
    expect(next.selectedModel).toBe("gpt-5");
    const target = next.sessions.find((item) => item.id === "a");
    expect(target?.providerId).toBe("p2");
    expect(target?.model).toBe("gpt-5");
    // The other session is untouched.
    expect(
      next.sessions.find((item) => item.id === "b")?.model,
    ).toBeUndefined();
  });

  test("selectEffort writes global + session; clearSessionEffort clears only the session", () => {
    const withEffort = selectEffort("a", "high")(state());
    expect(withEffort.selectedEffort).toBe("high");
    expect(withEffort.sessions.find((item) => item.id === "a")?.effort).toBe(
      "high",
    );
    const cleared = clearSessionEffort("a")(withEffort);
    expect(cleared.selectedEffort).toBe("high");
    expect(
      cleared.sessions.find((item) => item.id === "a")?.effort,
    ).toBeUndefined();
  });
});

describe("settings + MCP ops", () => {
  test("setTheme / setWebAccess / setCommandEnvironment write their fields", () => {
    expect(setTheme("dark")(state()).theme).toBe("dark");
    expect(setWebAccess(true)(state()).webAccess).toBe(true);
    expect(
      setCommandEnvironment("restricted")(state()).commandEnvironment,
    ).toBe("restricted");
  });

  test("setTerminalShell stores a path and clears when blank", () => {
    expect(setTerminalShell("/bin/zsh")(state()).terminalShell).toBe(
      "/bin/zsh",
    );
    expect(setTerminalShell("   ")(state()).terminalShell).toBeUndefined();
  });

  test("markCheckpointFilesRestored prunes files and finishes when empty", () => {
    const withCheckpoint = state();
    withCheckpoint.sessions[0].checkpoint = {
      id: "run-1",
      createdAt: 1,
      files: ["a.ts", "b.ts"],
    };
    const partial = markCheckpointFilesRestored(
      "a",
      ["a.ts"],
      LATER,
    )(withCheckpoint);
    const afterPartial = partial.sessions.find((item) => item.id === "a");
    expect(afterPartial?.checkpoint?.files).toEqual(["b.ts"]);
    expect(afterPartial?.checkpoint?.restoredAt).toBeUndefined();
    const full = markCheckpointFilesRestored("a", ["b.ts"], LATER)(partial);
    const afterFull = full.sessions.find((item) => item.id === "a");
    expect(afterFull?.checkpoint?.files).toEqual([]);
    expect(afterFull?.checkpoint?.restoredAt).toBe(LATER);
  });

  test("MCP servers round-trip", () => {
    const server = { name: "files", command: "mcp-files" };
    const added = addMcpServer(server)(state());
    expect(added.mcpServers).toEqual([server]);
    const removed = removeMcpServer("files")(added);
    expect(removed.mcpServers).toEqual([]);
  });

  test("setCustomInstructions keys by workspace and clears when blank", () => {
    const set = setCustomInstructions("/repo/a", "be terse")(state());
    expect(set.customInstructions).toEqual({ "/repo/a": "be terse" });
    // A second workspace coexists.
    const both = setCustomInstructions("/repo/b", "use tabs")(set);
    expect(both.customInstructions).toEqual({
      "/repo/a": "be terse",
      "/repo/b": "use tabs",
    });
    // Blank text removes that workspace's entry.
    const cleared = setCustomInstructions("/repo/a", "   ")(both);
    expect(cleared.customInstructions).toEqual({ "/repo/b": "use tabs" });
  });
});
