import type {
  AppState,
  Effort,
  ModelsEntry,
  RuntimeEvent,
  Session,
  TranscriptItem,
  Usage,
} from "@nexus/protocol";
import { clampEffort, DEFAULT_EFFORT, effortLevels } from "./capabilities";
import { basename, createId } from "./format";
import { parseJsonArgs, toolOwnsStreamedResult } from "./toolPresentation";
import type { WorkspaceSummary } from "./types";

/// The mutation tools whose calls change files on disk. `rename_file` is
/// handled separately (it carries `from`/`to`, not `path`).
const PATH_MUTATION_TOOLS = new Set([
  "create_file",
  "write_file",
  "edit_file",
  "multi_edit",
  "delete_file",
]);

/// Workspace-relative paths a tool call touches, for the session change set.
/// Non-mutating tools return an empty list.
export function mutationPaths(name: string, argsJson?: string): string[] {
  const args = parseJsonArgs(argsJson);
  if (name === "rename_file") {
    return [args.from, args.to].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
  }
  if (PATH_MUTATION_TOOLS.has(name)) {
    return typeof args.path === "string" && args.path ? [args.path] : [];
  }
  return [];
}

/// Merges new touched paths into a session's deduped `changedFiles`, preserving
/// first-seen order. Returns the same array reference when nothing is added so
/// callers can skip a needless state update.
export function addChangedFiles(
  existing: string[] | undefined,
  paths: string[],
): string[] {
  if (paths.length === 0) return existing ?? [];
  const merged = existing ? [...existing] : [];
  for (const path of paths) if (!merged.includes(path)) merged.push(path);
  return merged;
}

/// Deduplicates and trims a list of @-mention attachment paths, dropping blanks
/// while preserving first-seen order.
export function dedupeAttachments(attachments: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of attachments) {
    const path = raw.trim();
    if (path && !seen.has(path)) {
      seen.add(path);
      result.push(path);
    }
  }
  return result;
}

/// Folds @-mention attachments into the model-facing user message: the typed
/// text followed by an "Attached files" block listing paths for the agent to
/// read with read_file. The transcript keeps the clean typed text; only the
/// history message carries the block. Returns the text unchanged when there are
/// no attachments.
export function foldAttachments(text: string, attachments: string[]): string {
  const paths = dedupeAttachments(attachments);
  if (paths.length === 0) return text;
  const block = `Attached files (read them with read_file if relevant):\n${paths
    .map((path) => `- ${path}`)
    .join("\n")}`;
  return text ? `${text}\n\n${block}` : block;
}

export function sanitizeImportedSession(
  value: unknown,
  workspacePath: string,
): Session | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<Session>;
  if (!Array.isArray(raw.transcript) || !Array.isArray(raw.history))
    return undefined;
  const now = new Date().toISOString();
  return {
    id: createId(),
    title:
      typeof raw.title === "string" && raw.title.trim()
        ? raw.title.trim()
        : "Imported task",
    createdAt: now,
    updatedAt: now,
    workspacePath,
    transcript: raw.transcript.filter(
      (item): item is TranscriptItem =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as TranscriptItem).id === "string" &&
        typeof (item as TranscriptItem).kind === "string" &&
        typeof (item as TranscriptItem).detail === "string",
    ),
    history: raw.history.filter(
      (message): message is Session["history"][number] =>
        Boolean(message) &&
        typeof message === "object" &&
        typeof message.type === "string",
    ),
    plan: raw.plan,
    research: raw.research,
    approvalMode: raw.approvalMode,
  };
}

export function newSession(workspacePath: string): Session {
  const now = new Date().toISOString();
  return {
    id: createId(),
    title: "New task",
    createdAt: now,
    updatedAt: now,
    workspacePath,
    transcript: [],
    history: [],
  };
}

export function resolveModel(
  session: Session | undefined,
  state: AppState,
): { providerId?: string; model?: string } {
  const providerId = session?.providerId ?? state.selectedProviderId;
  const model = session?.model ?? state.selectedModel;
  const provider = state.providers.find((item) => item.id === providerId);
  return { providerId: provider?.id, model: provider ? model : undefined };
}

/// The effort to send with a run: per-session override, else the global default,
/// clamped to what the resolved model actually supports. `undefined` when the
/// model has no effort control (the runtime then omits the parameter).
export function resolveEffort(
  session: Session | undefined,
  state: AppState,
): Effort | undefined {
  const { providerId, model } = resolveModel(session, state);
  const provider = state.providers.find((item) => item.id === providerId);
  if (!provider || !model) return undefined;
  const chosen = session?.effort ?? state.selectedEffort ?? DEFAULT_EFFORT;
  return clampEffort(provider.kind, model, chosen);
}

/// The effort options offered for the resolved model: its models.dev catalog
/// entry when loaded, else the name-heuristic mirror, else empty (no effort
/// control).
export function resolveEffortOptions(
  state: AppState,
  session: Session | undefined,
  modelsByProvider: Record<string, ModelsEntry>,
): Effort[] {
  const { providerId, model } = resolveModel(session, state);
  const provider = state.providers.find((item) => item.id === providerId);
  if (!provider || !model) return [];
  const info = modelsByProvider[provider.id]?.models?.find(
    (item) => item.id === model,
  );
  return info ? info.effort : effortLevels(provider.kind, model);
}

export function deriveWorkspaces(state: AppState): WorkspaceSummary[] {
  const map = new Map<string, WorkspaceSummary>();
  for (const session of state.sessions) {
    const existing = map.get(session.workspacePath);
    if (existing) {
      existing.chatCount += 1;
      if (session.updatedAt > existing.updatedAt)
        existing.updatedAt = session.updatedAt;
    } else {
      map.set(session.workspacePath, {
        path: session.workspacePath,
        name: basename(session.workspacePath),
        chatCount: 1,
        updatedAt: session.updatedAt,
      });
    }
  }
  if (state.workspacePath && !map.has(state.workspacePath)) {
    map.set(state.workspacePath, {
      path: state.workspacePath,
      name: basename(state.workspacePath),
      chatCount: 0,
      updatedAt: new Date(0).toISOString(),
    });
  }
  return [...map.values()].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

export function groupSessions(
  state: AppState,
): { workspace: WorkspaceSummary; sessions: Session[] }[] {
  return deriveWorkspaces(state).map((workspace) => ({
    workspace,
    // Pinned sessions lead their group; recency orders within each half.
    sessions: state.sessions
      .filter(
        (session) =>
          session.workspacePath === workspace.path && !session.archivedAt,
      )
      .toSorted(
        (left, right) =>
          Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) ||
          right.updatedAt.localeCompare(left.updatedAt),
      ),
  }));
}

export function latestSessionId(state: AppState, workspacePath: string) {
  return state.sessions
    .filter((session) => session.workspacePath === workspacePath)
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .at(0)?.id;
}

export function updateSession(
  state: AppState,
  sessionId: string,
  updater: (session: Session) => Session,
): AppState {
  return {
    ...state,
    sessions: state.sessions.map((session) =>
      session.id === sessionId ? updater(session) : session,
    ),
  };
}

export function appendItem(
  state: AppState,
  sessionId: string,
  item: TranscriptItem,
  updatedAt: string,
): AppState {
  return updateSession(state, sessionId, (session) => ({
    ...session,
    transcript: [...session.transcript, item],
    updatedAt,
  }));
}

/// Reduce one runtime event into the transcript of the session that owns the
/// run — NOT the currently viewed session; the user may have switched away
/// mid-run. Unknown session ids no-op (updateSession matches nothing).
export function applyEvent(
  state: AppState,
  sessionId: string,
  event: RuntimeEvent,
  itemId: string,
  updatedAt: string,
): AppState {
  if (event.type === "assistant_text")
    return updateSession(state, sessionId, (session) => {
      const last = session.transcript.at(-1);
      const transcript: TranscriptItem[] =
        last?.kind === "assistant"
          ? [
              ...session.transcript.slice(0, -1),
              { ...last, detail: `${last.detail}${event.text}` },
            ]
          : [
              ...session.transcript,
              {
                id: itemId,
                kind: "assistant",
                title: "Nexus",
                detail: event.text,
              },
            ];
      return { ...session, transcript, updatedAt };
    });
  if (event.type === "provider_retry")
    return updateSession(state, sessionId, (session) => ({
      ...session,
      transcript: [
        ...session.transcript,
        {
          id: itemId,
          kind: "info",
          title: `Retrying provider (${event.attempt})`,
          detail: `${event.reason}. Retrying in ${Math.ceil(event.delayMs / 1000)}s.`,
        },
      ],
      updatedAt,
    }));
  if (event.type === "tool_call") {
    // Mutation calls grow the session's change set (for the Review panel); the
    // paths are recorded when the call is made. Declined edits that leave the
    // file otherwise unchanged just produce an empty diff the panel skips.
    const touched = mutationPaths(event.name, event.arguments);
    return updateSession(state, sessionId, (session) => ({
      ...session,
      transcript: [
        ...session.transcript,
        {
          id: itemId,
          kind: "tool",
          title: event.name,
          detail: event.summary,
          toolCallId: event.id,
          args: event.arguments,
        },
      ],
      changedFiles: addChangedFiles(session.changedFiles, touched),
      updatedAt,
    }));
  }
  if (event.type === "tool_result")
    return updateSession(state, sessionId, (session) => ({
      ...session,
      transcript: session.transcript.map((item) =>
        item.kind === "tool" &&
        (item.toolCallId === event.id ||
          (!event.id && item.title === event.name && !item.result))
          ? // Streaming tools own their `result` via command_output; don't
            // clobber the live output with the shorter tool_result preview.
            toolOwnsStreamedResult(item.title)
            ? item
            : { ...item, result: event.preview }
          : item,
      ),
      updatedAt,
    }));
  if (event.type === "command_output")
    return updateSession(state, sessionId, (session) => ({
      ...session,
      transcript: session.transcript.map((item) =>
        item.kind === "tool" && item.toolCallId === event.callId
          ? {
              ...item,
              result: `${item.result ?? ""}${event.chunk}\n`,
              running: true,
            }
          : item,
      ),
      updatedAt,
    }));
  if (event.type === "command_end")
    return updateSession(state, sessionId, (session) => ({
      ...session,
      transcript: session.transcript.map((item) =>
        item.kind === "tool" && item.toolCallId === event.callId
          ? {
              ...item,
              running: false,
              exitCode: event.exitCode,
              timedOut: event.timedOut,
            }
          : item,
      ),
      updatedAt,
    }));
  if (event.type === "research")
    return updateSession(state, sessionId, (session) => ({
      ...session,
      research: {
        title: event.title,
        markdown: event.markdown,
        updatedAt,
        ...(session.research
          ? {
              revisions: [
                ...(session.research.revisions ?? []),
                {
                  title: session.research.title,
                  markdown: session.research.markdown,
                  updatedAt: session.research.updatedAt,
                },
              ],
            }
          : {}),
      },
      updatedAt,
    }));
  // The feature plan is durable session state (not a transcript item) so the
  // plan panel can show it and track progress. A new plan keeps any todos
  // already gathered for this session.
  if (event.type === "plan")
    return updateSession(state, sessionId, (session) => ({
      ...session,
      plan: {
        title: event.title,
        markdown: event.markdown,
        todos: session.plan?.todos ?? [],
        updatedAt,
        ...(session.plan
          ? {
              revisions: [
                ...(session.plan.revisions ?? []),
                {
                  title: session.plan.title,
                  markdown: session.plan.markdown,
                  updatedAt: session.plan.updatedAt,
                },
              ],
            }
          : {}),
      },
      updatedAt,
    }));
  // todo_write also arrives as a tool_call (inline TodoCard); here we mirror
  // the list onto the plan so the panel checklist stays live. Only meaningful
  // once a plan exists — otherwise there's no panel to feed.
  if (event.type === "todos")
    return updateSession(state, sessionId, (session) =>
      session.plan
        ? {
            ...session,
            plan: { ...session.plan, todos: event.todos, updatedAt },
          }
        : session,
    );
  // Compaction folded older turns away; mark the spot in the transcript so the
  // user knows earlier context is now a summary.
  if (event.type === "compacted")
    return appendItem(
      state,
      sessionId,
      {
        id: itemId,
        kind: "info",
        title: "Context compacted",
        detail: `Summarized ${event.removedMessages} earlier messages to fit the context window; the ${event.keptMessages} most recent were kept verbatim.`,
        result: event.summary,
      },
      updatedAt,
    );
  // A sub-agent took a step; append a short label to its parent spawn_agent
  // tool item so the card shows live progress.
  if (event.type === "subagent_step") {
    const label = event.summary ? `${event.tool} ${event.summary}` : event.tool;
    return updateSession(state, sessionId, (session) => ({
      ...session,
      transcript: session.transcript.map((item) =>
        item.kind === "tool" && item.toolCallId === event.callId
          ? { ...item, subagentSteps: [...(item.subagentSteps ?? []), label] }
          : item,
      ),
      updatedAt,
    }));
  }
  return state;
}

export function finishRun(
  state: AppState,
  sessionId: string,
  result: Record<string, unknown>,
  updatedAt: string,
): AppState {
  const messages = Array.isArray(result.messages) ? result.messages : undefined;
  const usage = parseUsage(result.usage);
  const costUsd =
    typeof result.costUsd === "number" && Number.isFinite(result.costUsd)
      ? result.costUsd
      : undefined;
  const checkpoint = parseCheckpoint(result.checkpoint);
  return updateSession(state, sessionId, (session) => ({
    ...session,
    history: (messages as Session["history"]) ?? session.history,
    openAIResponseId:
      typeof result.openAIResponseId === "string"
        ? result.openAIResponseId
        : undefined,
    // Meter totals accumulate across the session's runs; a run without usage
    // (older runtime) leaves them untouched.
    usage: usage
      ? {
          inputTokens: (session.usage?.inputTokens ?? 0) + usage.inputTokens,
          outputTokens: (session.usage?.outputTokens ?? 0) + usage.outputTokens,
        }
      : session.usage,
    costUsd:
      costUsd !== undefined
        ? (session.costUsd ?? 0) + costUsd
        : session.costUsd,
    checkpoint: checkpoint ?? session.checkpoint,
    recovery: undefined,
    updatedAt,
  }));
}

function parseCheckpoint(value: unknown): Session["checkpoint"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.id !== "string" ||
    typeof raw.createdAt !== "number" ||
    !Array.isArray(raw.files)
  )
    return undefined;
  const files = raw.files.filter(
    (path): path is string => typeof path === "string",
  );
  if (files.length === 0) return undefined;
  const entries = Array.isArray(raw.entries)
    ? raw.entries.flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const entry = value as Record<string, unknown>;
        if (typeof entry.path !== "string") return [];
        return [
          {
            path: entry.path,
            tool: typeof entry.tool === "string" ? entry.tool : undefined,
            appliedAt:
              typeof entry.appliedAt === "number" ? entry.appliedAt : undefined,
          },
        ];
      })
    : undefined;
  return { id: raw.id, createdAt: raw.createdAt, files, entries };
}

function parseUsage(value: unknown): Usage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const inputTokens = typeof raw.inputTokens === "number" ? raw.inputTokens : 0;
  const outputTokens =
    typeof raw.outputTokens === "number" ? raw.outputTokens : 0;
  if (inputTokens === 0 && outputTokens === 0) return undefined;
  return { inputTokens, outputTokens };
}
