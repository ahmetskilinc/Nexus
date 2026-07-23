import type {
  AppState,
  PendingApproval,
  TranscriptItem,
} from "@nexus/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { createId } from "../lib/format";
import {
  applyEvent,
  dedupeAttachments,
  finishRun,
  foldAttachments,
  resolveEffort,
  resolveModel,
  updateSession,
} from "../lib/session";
import { commandProgram } from "../lib/toolPresentation";

/// One in-flight run. `runId` is undefined between startAgent() and its ack;
/// events arriving in that window still route correctly via `sessionId`.
type ActiveRun = { sessionId: string; runId?: string };

/// Runs keyed by the session that owns them — the split view can drive one
/// agent per pane concurrently (the runtime already executes runs as
/// independent tasks in a runId-keyed registry).
type ActiveRuns = Record<string, ActiveRun>;

/// The session-scoped agent-run API a chat pane consumes.
export type AgentRunApi = {
  isRunning: (sessionId: string) => boolean;
  pendingApprovalFor: (sessionId: string) => PendingApproval | undefined;
  send: (sessionId: string, text: string, attachments?: string[]) => boolean;
  cancel: (sessionId: string) => void;
  respondToApproval: (sessionId: string, approved: boolean) => void;
  alwaysAllowCommand: (sessionId: string) => void;
};

/// Owns the active agent runs: subscribes to runtime events/finished/failed,
/// exposes session-scoped `send` and `cancel`. Events route to the session
/// that started the run — not whichever session the user is currently viewing.
export function useAgentRun({
  state,
  setState,
  setError,
}: {
  state: AppState | undefined;
  setState: (
    updater: (current: AppState | undefined) => AppState | undefined,
  ) => void;
  setError: (error?: string) => void;
}): AgentRunApi {
  const [activeRuns, setActiveRunsState] = useState<ActiveRuns>({});
  const [pendingApprovals, setPendingApprovals] = useState<
    Record<string, PendingApproval>
  >({});
  // The event subscription is created once; the handlers read the live runs and
  // state through refs so they aren't stale without re-subscribing per render.
  const activeRunsRef = useRef<ActiveRuns>({});
  const stateRef = useRef(state);
  stateRef.current = state;

  // Ref and state updated together: the ref synchronously (send() relies on it
  // being set before startAgent resolves), the state for rendering.
  const setActiveRuns = useCallback(
    (updater: (current: ActiveRuns) => ActiveRuns) => {
      activeRunsRef.current = updater(activeRunsRef.current);
      setActiveRunsState(activeRunsRef.current);
    },
    [],
  );

  const clearRun = useCallback(
    (sessionId: string) => {
      setActiveRuns(({ [sessionId]: _gone, ...rest }) => rest);
      setPendingApprovals(({ [sessionId]: _gone, ...rest }) => rest);
    },
    [setActiveRuns],
  );

  useEffect(() => {
    // Events belong to a tracked run; stragglers from a cancelled or already
    // finished run are dropped rather than applied to an arbitrary session.
    // A run whose start-ack hasn't landed yet has no runId — events can only
    // claim it when it is the sole unacked run (ambiguity drops the event).
    const runFor = (runId: string): ActiveRun | undefined => {
      const runs = Object.values(activeRunsRef.current);
      const acked = runs.find((run) => run.runId === runId);
      if (acked) return acked;
      const unacked = runs.filter((run) => !run.runId);
      return unacked.length === 1 ? unacked[0] : undefined;
    };
    const cleanups = [
      window.nexus.onRuntimeEvent(({ runId, event }) => {
        const run = runFor(runId);
        if (!run) return;
        // An approval request pauses the run until the user decides; hold it in
        // ephemeral state rather than the persisted transcript.
        if (event.type === "approval_request") {
          if (event.kind === "command") {
            // Auto-approve commands whose program the user chose to always
            // allow in the session that owns the run, without surfacing a card.
            const program = commandProgram(event.command);
            const allowed = stateRef.current?.sessions
              .find((session) => session.id === run.sessionId)
              ?.allowedCommands?.includes(program);
            if (allowed) {
              void window.nexus.approveEdit(runId, event.callId, true);
              return;
            }
          }
          const { type: _type, ...request } = event;
          setPendingApprovals((current) => ({
            ...current,
            [run.sessionId]: { ...request, runId },
          }));
          return;
        }
        if (event.type === "authorize_url") return;
        const itemId = createId();
        const updatedAt = new Date().toISOString();
        setState(
          (current) =>
            current &&
            applyEvent(current, run.sessionId, event, itemId, updatedAt),
        );
      }),
      window.nexus.onRuntimeFinished(({ runId, result }) => {
        const run = runFor(runId);
        if (!run) return;
        clearRun(run.sessionId);
        const updatedAt = new Date().toISOString();
        setState(
          (current) =>
            current && finishRun(current, run.sessionId, result, updatedAt),
        );
      }),
      window.nexus.onRuntimeFailed(({ runId, message, cancelled }) => {
        const run = runFor(runId);
        if (!run) return;
        clearRun(run.sessionId);
        const item: TranscriptItem = {
          id: createId(),
          kind: cancelled ? "info" : "error",
          title: cancelled ? "Stopped" : "Agent failed",
          detail: cancelled ? "The agent run was cancelled." : message,
        };
        const updatedAt = new Date().toISOString();
        setState(
          (current) =>
            current &&
            updateSession(current, run.sessionId, (session) => ({
              ...session,
              recovery: undefined,
              transcript: [...session.transcript, item],
              updatedAt,
            })),
        );
      }),
    ];
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [setState, clearRun]);

  /// Starts a run for `sessionId` from `text` plus any @-mention `attachments`.
  /// Returns false when nothing was started (empty text and no attachments,
  /// unknown session, no model, or a run already in flight for this session) so
  /// the caller keeps its prompt.
  function send(
    sessionId: string,
    text: string,
    attachments: string[] = [],
  ): boolean {
    if (!state) return false;
    const appState = state;
    const session = appState.sessions.find((item) => item.id === sessionId);
    const trimmed = text.trim();
    const files = dedupeAttachments(attachments);
    const { providerId, model } = resolveModel(session, appState);
    if (
      (!trimmed && files.length === 0) ||
      !session ||
      !providerId ||
      !model ||
      activeRunsRef.current[sessionId]
    )
      return false;
    // The transcript keeps the clean typed text (or a short note when the
    // message is attachments-only); the model history carries the folded block.
    const detail =
      trimmed ||
      `Attached ${files.length} file${files.length === 1 ? "" : "s"}`;
    const historyText = foldAttachments(trimmed, files);
    const userItem: TranscriptItem = {
      id: createId(),
      kind: "user",
      title: "You",
      detail,
    };
    const updated = updateSession(appState, session.id, (item) => ({
      ...item,
      title: item.transcript.length ? item.title : detail.slice(0, 60),
      updatedAt: new Date().toISOString(),
      transcript: [...item.transcript, userItem],
      history: [...item.history, { type: "user", text: historyText }],
      recovery: { startedAt: new Date().toISOString(), status: "in_progress" },
    }));
    setState(() => updated);
    setError(undefined);
    // Track the run before starting it so events that beat the ack still route
    // to the session that owns them.
    setActiveRuns((current) => ({ ...current, [sessionId]: { sessionId } }));
    const history =
      updated.sessions.find((item) => item.id === session.id)?.history ?? [];
    window.nexus
      .startAgent({
        providerId,
        model,
        effort: resolveEffort(session, appState),
        approvalMode: session.approvalMode ?? "ask",
        workspacePath: session.workspacePath,
        history,
        previousOpenAIResponseId: session.openAIResponseId,
        webAccess: appState.webAccess ?? false,
        commandEnvironment: appState.commandEnvironment ?? "compatible",
        maxToolRounds: appState.maxToolRounds ?? 50,
        maxRunSeconds: appState.maxRunSeconds ?? 900,
        maxRunCostUsd: appState.maxRunCostUsd,
        mcpServers: appState.mcpServers ?? [],
        customInstructions:
          appState.customInstructions?.[session.workspacePath],
      })
      .then((runId) => {
        setState((appState) =>
          appState
            ? updateSession(appState, sessionId, (session) => ({
                ...session,
                recovery: session.recovery
                  ? { ...session.recovery, runId }
                  : session.recovery,
              }))
            : appState,
        );
        setActiveRuns((current) => {
          const run = current[sessionId];
          if (!run || run.runId) return current;
          return { ...current, [sessionId]: { ...run, runId } };
        });
      })
      .catch((reason: unknown) => {
        clearRun(sessionId);
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not start the agent.",
        );
      });
    return true;
  }

  function cancel(sessionId: string) {
    const runId = activeRunsRef.current[sessionId]?.runId;
    if (runId) void window.nexus.cancelAgent(runId);
  }

  const respondToApproval = useCallback(
    (sessionId: string, approved: boolean) => {
      setPendingApprovals(({ [sessionId]: current, ...rest }) => {
        if (!current) return rest;
        void window.nexus.approveEdit(current.runId, current.callId, approved);
        return rest;
      });
    },
    [],
  );

  // Approve a pending command AND remember its program so future commands with
  // the same program run without prompting in the session that owns the run.
  const alwaysAllowCommand = useCallback(
    (sessionId: string) => {
      setPendingApprovals(({ [sessionId]: current, ...rest }) => {
        if (current?.kind !== "command")
          return current ? { ...rest, [sessionId]: current } : rest;
        const program = commandProgram(current.command);
        setState((appState) => {
          if (!appState) return appState;
          return updateSession(appState, sessionId, (session) => ({
            ...session,
            allowedCommands: Array.from(
              new Set([...(session.allowedCommands ?? []), program]),
            ),
          }));
        });
        void window.nexus.approveEdit(current.runId, current.callId, true);
        return rest;
      });
    },
    [setState],
  );

  return {
    isRunning: (sessionId) => Boolean(activeRuns[sessionId]),
    pendingApprovalFor: (sessionId) => pendingApprovals[sessionId],
    send,
    cancel,
    respondToApproval,
    alwaysAllowCommand,
  };
}
