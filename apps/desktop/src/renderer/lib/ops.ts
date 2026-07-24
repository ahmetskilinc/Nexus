import type {
  ApprovalMode,
  AppState,
  Effort,
  McpServerConfig,
  ProviderProfile,
  Session,
  ThemePreference,
} from "@nexus/protocol";
import { updateSession } from "./session";

/// A named, pure state operation. Callers hand ops to `apply` (app.tsx), which
/// runs them as functional setState updates — so an op composed after an await
/// still sees the latest state instead of a stale closure. Impure inputs (ids,
/// timestamps) stay at call sites to keep ops deterministic for tests.
export type AppOp = (state: AppState) => AppState;

// MARK: - Top-level settings

export const clearRunJournal =
  (sessionId: string): AppOp =>
  (state) =>
    updateSession(state, sessionId, (session) => ({
      ...session,
      runJournal: undefined,
    }));

export const setTheme =
  (theme: ThemePreference): AppOp =>
  (state) => ({ ...state, theme });

export const setReduceMotion =
  (reduceMotion: boolean): AppOp =>
  (state) => ({ ...state, reduceMotion });

export const setWebAccess =
  (webAccess: boolean): AppOp =>
  (state) => ({ ...state, webAccess });

export const setCommandEnvironment =
  (commandEnvironment: "compatible" | "restricted"): AppOp =>
  (state) => ({ ...state, commandEnvironment });

/// Sets (or, when blank, clears) the integrated terminal's shell path.
export const setTerminalShell =
  (shell: string): AppOp =>
  (state) => ({ ...state, terminalShell: shell.trim() ? shell : undefined });

export const setMaxToolRounds =
  (maxToolRounds: number): AppOp =>
  (state) => ({
    ...state,
    maxToolRounds: Math.max(1, Math.min(200, maxToolRounds)),
  });

export const setMaxRunSeconds =
  (maxRunSeconds: number): AppOp =>
  (state) => ({
    ...state,
    maxRunSeconds: Math.max(30, Math.min(3600, maxRunSeconds)),
  });

export const setMaxRunCostUsd =
  (maxRunCostUsd?: number): AppOp =>
  (state) => ({
    ...state,
    maxRunCostUsd:
      maxRunCostUsd && maxRunCostUsd > 0
        ? Math.min(1000, maxRunCostUsd)
        : undefined,
  });

/// Sets (or, when the text is blank, clears) the per-workspace instruction
/// override keyed by workspace path.
export const setCustomInstructions =
  (workspacePath: string, text: string): AppOp =>
  (state) => {
    const next = { ...(state.customInstructions ?? {}) };
    if (text.trim()) next[workspacePath] = text;
    else delete next[workspacePath];
    return { ...state, customInstructions: next };
  };

// MARK: - Providers

/// Adds a (verified) provider and selects it.
export const addProvider =
  (provider: ProviderProfile): AppOp =>
  (state) => ({
    ...state,
    providers: [...state.providers, provider],
    selectedProviderId: provider.id,
  });

/// Removes a provider; if it was selected, selection moves to the first
/// surviving provider (or clears).
export const removeProvider =
  (providerId: string): AppOp =>
  (state) => {
    const fallback = state.providers.find((item) => item.id !== providerId)?.id;
    return {
      ...state,
      providers: state.providers.filter((item) => item.id !== providerId),
      selectedProviderId:
        state.selectedProviderId === providerId
          ? fallback
          : state.selectedProviderId,
      // Repair stale per-session references immediately. Model selection falls
      // back through the new provider's catalog on the next picker interaction.
      sessions: state.sessions.map((session) =>
        session.providerId === providerId
          ? {
              ...session,
              providerId: fallback,
              model: undefined,
              effort: undefined,
            }
          : session,
      ),
    };
  };

// MARK: - MCP servers

export const addMcpServer =
  (server: McpServerConfig): AppOp =>
  (state) => ({
    ...state,
    mcpServers: [...(state.mcpServers ?? []), server],
  });

export const removeMcpServer =
  (name: string): AppOp =>
  (state) => ({
    ...state,
    mcpServers: (state.mcpServers ?? []).filter(
      (server) => server.name !== name,
    ),
  });

export const toggleMcpServer =
  (name: string): AppOp =>
  (state) => ({
    ...state,
    mcpServers: (state.mcpServers ?? []).map((server) =>
      server.name === name
        ? { ...server, enabled: server.enabled === false }
        : server,
    ),
  });

// MARK: - Sessions & workspace

/// Appends a new session and makes it current.
export const addSession =
  (session: Session): AppOp =>
  (state) => ({
    ...state,
    sessions: [...state.sessions, session],
    currentSessionId: session.id,
  });

/// Opens a workspace with a fresh session in it.
export const openWorkspace =
  (workspacePath: string, session: Session): AppOp =>
  (state) => ({
    ...state,
    workspacePath,
    sessions: [...state.sessions, session],
    currentSessionId: session.id,
  });

const oppositeSide = (side: "left" | "right") =>
  side === "left" ? ("right" as const) : ("left" as const);

/// Which side the *unfocused* pane sits on (absent means "right").
export const sidePositionOf = (state: AppState): "left" | "right" =>
  state.sidePosition ?? "right";

/// Moves focus to the unfocused pane's session without moving any pane: the
/// current and side sessions swap roles, so `sidePosition` flips to keep both
/// panes physically where they were. Workspace context follows focus. Ids that
/// aren't the side session no-op.
export const focusSession =
  (sessionId: string): AppOp =>
  (state) => {
    if (sessionId !== state.sideSessionId || !state.currentSessionId)
      return state;
    const session = state.sessions.find((item) => item.id === sessionId);
    if (!session) return state;
    return {
      ...state,
      workspacePath: session.workspacePath,
      currentSessionId: sessionId,
      sideSessionId: state.currentSessionId,
      sidePosition: oppositeSide(sidePositionOf(state)),
    };
  };

/// Switches to a session, following it to its workspace. Unknown ids no-op.
/// In split view: selecting the other pane's session just moves focus there
/// (panes stay put); selecting a third session replaces the focused pane's
/// chat and keeps the split.
export const selectSession =
  (sessionId: string): AppOp =>
  (state) => {
    if (sessionId === state.sideSessionId)
      return focusSession(sessionId)(state);
    const session = state.sessions.find((item) => item.id === sessionId);
    if (!session) return state;
    return {
      ...state,
      workspacePath: session.workspacePath,
      currentSessionId: sessionId,
    };
  };

/// Opens a session on the given side of a split, focused: it becomes the
/// current session and the previously focused session moves to the opposite
/// side as the unfocused pane. The focused session itself and unknown ids
/// no-op.
export const openSessionInSplit =
  (sessionId: string, side: "left" | "right"): AppOp =>
  (state) => {
    if (sessionId === state.currentSessionId || !state.currentSessionId)
      return state;
    const session = state.sessions.find((item) => item.id === sessionId);
    if (!session) return state;
    return {
      ...state,
      workspacePath: session.workspacePath,
      currentSessionId: sessionId,
      sideSessionId: state.currentSessionId,
      sidePosition: oppositeSide(side),
    };
  };

/// Closes whichever pane holds `sessionId`; the surviving session stays (and
/// gains focus if it didn't have it). No-op when not split or for ids in
/// neither pane.
export const closeSplitPane =
  (sessionId: string): AppOp =>
  (state) => {
    if (!state.sideSessionId) return state;
    if (sessionId === state.sideSessionId) {
      return { ...state, sideSessionId: undefined, sidePosition: undefined };
    }
    if (sessionId !== state.currentSessionId) return state;
    const survivor = state.sessions.find(
      (item) => item.id === state.sideSessionId,
    );
    return {
      ...state,
      workspacePath: survivor?.workspacePath ?? state.workspacePath,
      currentSessionId: state.sideSessionId,
      sideSessionId: undefined,
      sidePosition: undefined,
    };
  };

/// Persists the split divider position (the left pane's share). Clamped to the
/// same 30–70% band the drag handler enforces, so a corrupt saved value can't
/// crush a pane.
export const setSplitRatio =
  (ratio: number): AppOp =>
  (state) => ({ ...state, splitRatio: Math.max(0.3, Math.min(0.7, ratio)) });

export const setApprovalMode =
  (sessionId: string, mode: ApprovalMode, updatedAt: string): AppOp =>
  (state) =>
    updateSession(state, sessionId, (session) => ({
      ...session,
      approvalMode: mode,
      updatedAt,
    }));

export const markCheckpointRestored =
  (sessionId: string, restoredAt: string): AppOp =>
  (state) =>
    updateSession(state, sessionId, (session) =>
      session.checkpoint
        ? {
            ...session,
            checkpoint: { ...session.checkpoint, restoredAt },
            updatedAt: restoredAt,
          }
        : session,
    );

/// Records a per-file restore: the reverted paths leave the checkpoint's file
/// list (the runtime pruned them from the stored checkpoint too), and once no
/// files remain the checkpoint counts as fully restored.
export const markCheckpointFilesRestored =
  (sessionId: string, paths: string[], restoredAt: string): AppOp =>
  (state) =>
    updateSession(state, sessionId, (session) => {
      if (!session.checkpoint) return session;
      const files = session.checkpoint.files.filter(
        (file) => !paths.includes(file),
      );
      return {
        ...session,
        checkpoint: {
          ...session.checkpoint,
          files,
          restoredAt:
            files.length === 0 ? restoredAt : session.checkpoint.restoredAt,
        },
        updatedAt: restoredAt,
      };
    });

export const duplicateSession =
  (sessionId: string, id: string, now: string): AppOp =>
  (state) => {
    const source = state.sessions.find((session) => session.id === sessionId);
    if (!source) return state;
    const copy: Session = {
      ...structuredClone(source),
      id,
      title: `${source.title} copy`,
      createdAt: now,
      updatedAt: now,
      pinned: false,
      archivedAt: undefined,
      checkpoint: undefined,
    };
    return {
      ...state,
      sessions: [...state.sessions, copy],
      currentSessionId: copy.id,
      workspacePath: copy.workspacePath,
    };
  };

export const archiveSession =
  (sessionId: string, archivedAt: string): AppOp =>
  (state) => {
    const target = state.sessions.find((session) => session.id === sessionId);
    if (!target) return state;
    const updated = updateSession(state, sessionId, (session) => ({
      ...session,
      archivedAt,
    }));
    if (state.currentSessionId !== sessionId) return updated;
    const next = updated.sessions
      .filter((session) => !session.archivedAt && session.id !== sessionId)
      .toSorted((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      )[0];
    return {
      ...updated,
      currentSessionId: next?.id,
      workspacePath: next?.workspacePath ?? state.workspacePath,
      sideSessionId:
        updated.sideSessionId === sessionId ? undefined : updated.sideSessionId,
    };
  };

export const restoreArchivedSession =
  (sessionId: string): AppOp =>
  (state) =>
    updateSession(state, sessionId, (session) => ({
      ...session,
      archivedAt: undefined,
    }));

/// Retitles a session. Call sites trim and guard against empty titles.
export const renameSession =
  (sessionId: string, title: string, updatedAt: string): AppOp =>
  (state) =>
    updateSession(state, sessionId, (session) => ({
      ...session,
      title,
      updatedAt,
    }));

/// Pinned sessions sort before the rest of their workspace group.
export const togglePinSession =
  (sessionId: string): AppOp =>
  (state) =>
    updateSession(state, sessionId, (session) => ({
      ...session,
      pinned: !session.pinned,
    }));

/// Deletes a session. If it was current, selection moves to the most recent
/// survivor in the same workspace, else the most recent overall (following
/// `workspacePath` to wherever selection lands); unknown ids no-op.
export const deleteSession =
  (sessionId: string): AppOp =>
  (state) => {
    const target = state.sessions.find((item) => item.id === sessionId);
    if (!target) return state;
    const sessions = state.sessions.filter((item) => item.id !== sessionId);
    // Deleting the session shown in the unfocused pane collapses the split.
    const sideCleared = state.sideSessionId === sessionId;
    const sideSessionId = sideCleared ? undefined : state.sideSessionId;
    const sidePosition = sideCleared ? undefined : state.sidePosition;
    if (state.currentSessionId !== sessionId) {
      return { ...state, sessions, sideSessionId, sidePosition };
    }
    const byRecency = (list: Session[]) =>
      list.toSorted((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      )[0];
    // Deleting the focused session: the split survivor takes over (collapsing
    // the split); otherwise selection falls back by recency.
    const survivor = sessions.find((item) => item.id === sideSessionId);
    const next =
      survivor ??
      byRecency(
        sessions.filter((item) => item.workspacePath === target.workspacePath),
      ) ??
      byRecency(sessions);
    const landsOnSide = next?.id === sideSessionId;
    return {
      ...state,
      sessions,
      currentSessionId: next?.id,
      sideSessionId: landsOnSide ? undefined : sideSessionId,
      sidePosition: landsOnSide ? undefined : sidePosition,
      workspacePath: next?.workspacePath ?? state.workspacePath,
    };
  };

/// Deletes several sessions in one state transition by folding `deleteSession`
/// over the ids. Each step reuses the survivor/side-pane logic and no-ops on
/// unknown ids, so batch order stays safe.
export const deleteSessions =
  (ids: string[]): AppOp =>
  (state) =>
    ids.reduce((acc, id) => deleteSession(id)(acc), state);

// MARK: - Model / effort selection

/// Sets the global default model AND the session override in one step.
export const selectModel =
  (sessionId: string, providerId: string, model: string): AppOp =>
  (state) =>
    updateSession(
      { ...state, selectedProviderId: providerId, selectedModel: model },
      sessionId,
      (session) => ({ ...session, providerId, model }),
    );

export const selectEffort =
  (sessionId: string, effort: Effort): AppOp =>
  (state) =>
    updateSession(
      { ...state, selectedEffort: effort },
      sessionId,
      (session) => ({
        ...session,
        effort,
      }),
    );

/// Clears the per-session override so runs fall back to the global default.
export const clearSessionEffort =
  (sessionId: string): AppOp =>
  (state) =>
    updateSession(state, sessionId, (session) => ({
      ...session,
      effort: undefined,
    }));
