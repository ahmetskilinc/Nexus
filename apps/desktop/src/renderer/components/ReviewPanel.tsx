import type { BranchSync, WorkspaceChange } from "@nexus/protocol";
import { m } from "motion/react";
import {
  lazy,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from "react";
import { basename } from "../lib/format";
import { CloseIcon, FileIcon, GitBranchIcon, UploadIcon } from "./Icons";
import { Hint } from "./Tooltip";

const PatchDiff = lazy(() =>
  import("@pierre/diffs/react").then(({ PatchDiff: Component }) => ({
    default: Component,
  })),
);

type Entry = { path: string; patch: string; loading: boolean };

/// A working-tree center: staged/unstaged file actions, commit creation, and a
/// combined diff. Git operations are structured runtime calls, never shell text
/// assembled in the renderer.
export function ReviewPanel({
  changes,
  onStageFiles,
  onUnstageFiles,
  onCommit,
  onDiscardFile,
  sync,
  onPush,
  canRestoreCheckpoint,
  checkpointFiles,
  checkpointEntries,
  onRestoreCheckpoint,
  onRestoreLatestMutation,
  onRestoreCheckpointFile,
  codeTheme,
  onClose,
  onResizeStart,
  onResizeKeyDown,
}: {
  changes: WorkspaceChange[];
  onStageFiles: (paths: string[]) => Promise<void>;
  onUnstageFiles: (paths: string[]) => Promise<void>;
  onCommit: (message: string) => Promise<boolean>;
  onDiscardFile: (path: string) => Promise<void>;
  /// The checked-out branch's standing against its upstream.
  sync: BranchSync;
  onPush: () => Promise<boolean>;
  canRestoreCheckpoint: boolean;
  /// Files still revertible from the last run's checkpoint (empty when none).
  checkpointFiles: string[];
  /// Secret-free provenance for checkpoint files, keyed by path.
  checkpointEntries: Array<{ path: string; tool?: string; appliedAt?: number }>;
  onRestoreCheckpoint: () => Promise<void>;
  onRestoreLatestMutation: (path: string) => Promise<void>;
  onRestoreCheckpointFile: (path: string) => Promise<void>;
  codeTheme: string;
  onClose: () => void;
  onResizeStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onResizeKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [pushing, setPushing] = useState(false);
  const visible = useMemo(
    () => changes.filter((change) => change.status !== "ignored"),
    [changes],
  );
  const staged = visible.filter((change) => change.staged);
  const unstaged = visible.filter((change) => change.unstaged);
  const paths = useMemo(
    () => Array.from(new Set(visible.map((change) => change.path))),
    [visible],
  );

  useEffect(() => {
    let cancelled = false;
    setEntries(paths.map((path) => ({ path, patch: "", loading: true })));
    void Promise.all(
      paths.map(async (path) => {
        try {
          return {
            path,
            patch: await window.nexus.workspaceDiff(path),
            loading: false,
          };
        } catch {
          return { path, patch: "", loading: false };
        }
      }),
    ).then((next) => {
      if (!cancelled) setEntries(next);
    });
    return () => {
      cancelled = true;
    };
  }, [paths]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!message.trim() || staged.length === 0) return;
    setBusy(true);
    try {
      if (await onCommit(message.trim())) setMessage("");
    } finally {
      setBusy(false);
    }
  }

  async function push() {
    if (pushing) return;
    setPushing(true);
    try {
      await onPush();
    } finally {
      setPushing(false);
    }
  }

  // A branch with no upstream is published (`--set-upstream`) rather than
  // pushed, and has no ahead count to show until it is tracking something.
  const publishing = sync.branch !== null && sync.upstream === null;
  const canPush =
    sync.hasRemote && sync.branch !== null && (publishing || sync.ahead > 0);
  const pushHint = publishing
    ? `Publish ${sync.branch} to the remote and track it`
    : `Push ${sync.ahead} commit${sync.ahead === 1 ? "" : "s"} to ${sync.upstream}` +
      (sync.behind > 0
        ? ` — ${sync.behind} behind, the push may be rejected`
        : "");

  const shown = entries.filter((entry) => entry.patch.trim());
  const anyLoading = entries.some((entry) => entry.loading);
  const checkpointByPath = new Map(
    checkpointEntries.map((entry) => [entry.path, entry]),
  );

  return (
    <m.aside
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      style={{ gridColumn: 3 }}
      className="relative flex h-screen min-h-0 flex-col overflow-hidden border-l border-border bg-panel"
    >
      <button
        type="button"
        aria-label="Resize panel"
        className="absolute inset-y-0 left-0 z-20 w-2 cursor-col-resize touch-none focus-visible:bg-primary/25 focus-visible:outline-none"
        onPointerDown={onResizeStart}
        onKeyDown={onResizeKeyDown}
      />

      <div className="app-drag flex h-11 shrink-0 items-center gap-2 border-b border-border-soft px-3 pr-[var(--corner-controls,0px)]">
        <span className="grid size-5 shrink-0 place-items-center rounded-md bg-primary/10 text-primary-soft">
          <GitBranchIcon size={13} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
          Changes
          {visible.length ? (
            <span className="ml-1.5 text-faint">{visible.length}</span>
          ) : null}
        </span>
        {canPush ? (
          <Hint label={pushHint} side="bottom">
            <button
              type="button"
              disabled={pushing}
              onClick={() => void push()}
              className="app-no-drag flex shrink-0 items-center gap-1 rounded bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary-soft transition hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <UploadIcon size={11} />
              {pushing
                ? "Pushing…"
                : publishing
                  ? "Publish"
                  : `Push ${sync.ahead}`}
            </button>
          </Hint>
        ) : null}
        {canRestoreCheckpoint ? (
          <button
            type="button"
            onClick={() => void onRestoreCheckpoint()}
            className="app-no-drag rounded px-2 py-1 text-[10px] font-medium text-primary-soft transition hover:bg-accent"
          >
            Undo run
          </button>
        ) : null}
        <Hint label="Close panel" side="left">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="app-no-drag grid size-6 shrink-0 place-items-center rounded text-faint transition hover:bg-accent hover:text-foreground"
          >
            <CloseIcon size={14} />
          </button>
        </Hint>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {checkpointFiles.length > 0 ? (
          <section className="border-b border-border-soft">
            <div className="flex items-center gap-2 px-3 py-2">
              <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Run checkpoint
              </span>
              <span className="font-mono text-[10px] text-faint">
                {checkpointFiles.length}
              </span>
            </div>
            <p className="px-3 pb-1 text-[11px] leading-relaxed text-faint">
              Revert files to their state before the last agent run. A file that
              changed since the run is left untouched.
            </p>
            <ul className="pb-1">
              {checkpointFiles.map((path) => {
                const audit = checkpointByPath.get(path);
                const provenance = audit?.tool
                  ? `${audit.tool}${
                      audit.appliedAt
                        ? ` · ${new Date(audit.appliedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                        : ""
                    }`
                  : "Agent mutation";
                return (
                  <li
                    key={path}
                    className="group flex items-center gap-2 px-3 py-1.5 hover:bg-accent"
                  >
                    <FileIcon
                      size={12}
                      className="shrink-0 text-muted-foreground"
                    />
                    <div className="min-w-0 flex-1">
                      <span
                        className="block truncate text-[11px] text-foreground"
                        title={path}
                      >
                        {path}
                      </span>
                      <span className="block truncate text-[10px] text-faint">
                        {provenance}
                      </span>
                    </div>
                    <div className="flex gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                      {audit ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void run(() => onRestoreLatestMutation(path))
                          }
                          className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-30"
                        >
                          Undo latest
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run(() => onRestoreCheckpointFile(path))
                        }
                        className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-30"
                      >
                        Revert run
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
        {visible.length === 0 ? (
          <div className="grid min-h-72 place-items-center px-6 text-center">
            <div>
              <GitBranchIcon size={24} className="mx-auto mb-3 text-faint" />
              <p className="text-[13px] font-medium text-foreground">
                Working tree clean
              </p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Local changes will appear here for review and commit.
              </p>
            </div>
          </div>
        ) : (
          <>
            <ChangeGroup
              title="Staged changes"
              changes={staged}
              action="Unstage"
              busy={busy}
              onAction={(path) => run(() => onUnstageFiles([path]))}
              onAll={() =>
                run(() => onUnstageFiles(staged.map(({ path }) => path)))
              }
            />
            <ChangeGroup
              title="Unstaged changes"
              changes={unstaged}
              action="Stage"
              busy={busy}
              onAction={(path) => run(() => onStageFiles([path]))}
              onAll={() =>
                run(() => onStageFiles(unstaged.map(({ path }) => path)))
              }
              onDiscard={(path) => {
                if (
                  window.confirm(
                    `Discard all changes to ${path}? This cannot be undone.`,
                  )
                )
                  void run(() => onDiscardFile(path));
              }}
            />

            <section className="border-b border-border-soft px-3 py-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Commit
                </span>
                <span className="text-[10px] text-faint">
                  {staged.length} staged
                </span>
              </div>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Commit message"
                rows={3}
                className="w-full resize-y rounded-lg border border-border-soft bg-background px-3 py-2 text-[12px] leading-relaxed text-foreground outline-none placeholder:text-faint focus:border-primary-dim"
              />
              <button
                type="button"
                disabled={busy || staged.length === 0 || !message.trim()}
                onClick={() => void commit()}
                className="mt-2 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground transition hover:bg-primary-soft disabled:cursor-not-allowed disabled:bg-secondary disabled:text-faint"
              >
                Commit staged changes
              </button>
            </section>

            <section>
              <div className="sticky top-0 z-10 border-b border-border-soft bg-panel/95 px-3 py-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase backdrop-blur">
                Combined diff
              </div>
              {shown.length === 0 ? (
                <p className="px-4 py-6 text-center text-[12px] text-faint">
                  {anyLoading
                    ? "Loading changes…"
                    : "No text diff is available. Untracked or binary files can still be staged above."}
                </p>
              ) : (
                shown.map((entry) => (
                  <div key={entry.path} className="border-b border-border-soft">
                    <div className="flex items-center gap-2 px-3 py-2">
                      <FileIcon size={12} className="text-muted-foreground" />
                      <span className="text-[12px] font-medium text-foreground">
                        {basename(entry.path)}
                      </span>
                      <span className="min-w-0 truncate text-[10px] text-faint">
                        {entry.path}
                      </span>
                    </div>
                    <Suspense
                      fallback={
                        <p className="p-3 text-[11px] text-faint">
                          Loading diff…
                        </p>
                      }
                    >
                      <PatchDiff
                        patch={entry.patch}
                        options={{
                          theme: codeTheme,
                          diffStyle: "unified",
                          overflow: "scroll",
                          disableFileHeader: true,
                        }}
                      />
                    </Suspense>
                  </div>
                ))
              )}
            </section>
          </>
        )}
      </div>
    </m.aside>
  );
}

function ChangeGroup({
  title,
  changes,
  action,
  busy,
  onAction,
  onAll,
  onDiscard,
}: {
  title: string;
  changes: WorkspaceChange[];
  action: string;
  busy: boolean;
  onAction: (path: string) => void;
  onAll: () => void;
  onDiscard?: (path: string) => void;
}) {
  if (changes.length === 0) return null;
  return (
    <section className="border-b border-border-soft">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          {title}
        </span>
        <span className="font-mono text-[10px] text-faint">
          {changes.length}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={onAll}
          className="ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium text-primary-soft hover:bg-accent disabled:opacity-50"
        >
          {action} all
        </button>
      </div>
      <ul className="pb-1">
        {changes.map((change) => (
          <li
            key={`${title}:${change.path}`}
            className="group flex items-center gap-2 px-3 py-1.5 hover:bg-accent"
          >
            <StatusBadge status={change.status} />
            <span
              className="min-w-0 flex-1 truncate text-[11px] text-foreground"
              title={change.path}
            >
              {change.path}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction(change.path)}
              className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground opacity-0 transition hover:bg-secondary hover:text-foreground disabled:opacity-30 group-hover:opacity-100 group-focus-within:opacity-100"
            >
              {action}
            </button>
            {onDiscard ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => onDiscard(change.path)}
                className="rounded px-1.5 py-0.5 text-[10px] text-faint opacity-0 transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-30 group-hover:opacity-100 group-focus-within:opacity-100"
              >
                Discard
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function StatusBadge({ status }: { status: WorkspaceChange["status"] }) {
  const letter = {
    added: "A",
    conflicted: "!",
    deleted: "D",
    ignored: "I",
    modified: "M",
    renamed: "R",
    untracked: "U",
  }[status];
  return (
    <span
      className={`w-4 shrink-0 font-mono text-[10px] font-semibold ${
        status === "conflicted" || status === "deleted"
          ? "text-destructive"
          : status === "added" || status === "untracked"
            ? "text-positive"
            : "text-warning"
      }`}
    >
      {letter}
    </span>
  );
}
