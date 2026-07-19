import type { SessionResearch } from "@nexus/protocol";
import { m } from "motion/react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useState,
} from "react";
import { AiIcon, CloseIcon } from "./Icons";
import { Markdown } from "./Markdown";
import { Hint } from "./Tooltip";

/// A durable, read-only codebase report published by Deep Research mode.
export function ResearchPanel({
  research,
  onCreateTask,
  onClose,
  onResizeStart,
  onResizeKeyDown,
}: {
  research?: SessionResearch;
  onCreateTask: (prompt: string) => void;
  onClose: () => void;
  onResizeStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onResizeKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
}) {
  const revisions = research?.revisions ?? [];
  const [revisionIndex, setRevisionIndex] = useState<number>();
  const shown =
    revisionIndex === undefined ? research : revisions[revisionIndex];

  function download() {
    if (!shown) return;
    const blob = new Blob([`# ${shown.title}\n\n${shown.markdown}\n`], {
      type: "text/markdown",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${slug(shown.title || "research")}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

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
      <div className="app-drag flex h-11 shrink-0 items-center gap-1 border-b border-border-soft px-3 pr-[var(--corner-controls,0px)]">
        <span className="grid size-5 shrink-0 place-items-center rounded-md bg-primary/10 text-primary-soft">
          <AiIcon size={13} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
          Research report
        </span>
        <ArtifactAction
          onClick={() =>
            void navigator.clipboard.writeText(shown?.markdown ?? "")
          }
        >
          Copy
        </ArtifactAction>
        <ArtifactAction onClick={download}>Export</ArtifactAction>
        {research ? (
          <ArtifactAction
            onClick={() =>
              onCreateTask(
                `Use this research report as context and create an implementation plan.\n\n# ${research.title}\n\n${research.markdown}`,
              )
            }
          >
            Create task
          </ArtifactAction>
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

      {shown ? (
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
          <header className="border-b border-border-soft bg-background/45 px-5 py-5">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[10px] font-semibold tracking-[0.14em] text-primary-soft uppercase">
                Deep research
              </span>
              <span className="rounded-full border border-border-soft bg-card px-2 py-0.5 text-[9px] font-medium tracking-wide text-muted-foreground uppercase">
                Read-only
              </span>
            </div>
            <h1 className="text-[20px] leading-tight font-semibold tracking-[-0.02em] text-foreground">
              {shown.title.trim() || "Research report"}
            </h1>
            <p className="mt-2 text-[11px] text-faint">
              Updated {formatArtifactDate(shown.updatedAt)}
            </p>
          </header>
          <article className="px-5 py-6">
            <Markdown content={shown.markdown} variant="artifact" />
          </article>
          {revisions.length > 0 ? (
            <RevisionSelect
              count={revisions.length}
              value={revisionIndex}
              labels={revisions.map((revision) => ({
                id: `${revision.updatedAt}-${revision.title}`,
                text: formatArtifactDate(revision.updatedAt),
              }))}
              onChange={setRevisionIndex}
            />
          ) : null}
        </div>
      ) : (
        <div className="grid flex-1 place-items-center px-8 text-center">
          <div className="max-w-64">
            <AiIcon size={24} className="mx-auto mb-3 text-faint" />
            <p className="text-[13px] font-medium text-foreground">
              No research report yet
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              Deep Research investigates the codebase with read-only tools and
              publishes its evidence and findings here.
            </p>
          </div>
        </div>
      )}
    </m.aside>
  );
}

function ArtifactAction({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="app-no-drag rounded px-1.5 py-1 text-[10px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
    >
      {children}
    </button>
  );
}

function RevisionSelect({
  value,
  labels,
  onChange,
}: {
  count: number;
  value?: number;
  labels: { id: string; text: string }[];
  onChange: (value?: number) => void;
}) {
  return (
    <div className="border-t border-border-soft px-5 py-3 text-[10px] font-semibold tracking-wide text-faint uppercase">
      Revision
      <select
        value={value ?? "current"}
        onChange={(event) =>
          onChange(
            event.target.value === "current"
              ? undefined
              : Number(event.target.value),
          )
        }
        className="ml-2 rounded border border-border-soft bg-card px-2 py-1 text-[11px] font-normal normal-case text-foreground"
      >
        <option value="current">Current</option>
        {labels.map((label, index) => (
          <option key={label.id} value={index}>
            {label.text}
          </option>
        ))}
      </select>
    </div>
  );
}

function formatArtifactDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function slug(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "research"
  );
}
