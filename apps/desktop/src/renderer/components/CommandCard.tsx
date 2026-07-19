import type { TranscriptItem } from "@nexus/protocol";
import { m } from "motion/react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { rise } from "../lib/motion";
import { commandFromArgs } from "../lib/toolPresentation";
import { TerminalIcon } from "./Icons";
import { ToolCard } from "./ToolCard";

/// The status chip shown at the right of a run_command header: a pulsing dot
/// while output streams, then the exit code / timed-out / terminated outcome.
function StatusChip({ item }: { item: TranscriptItem }) {
  if (
    item.running ||
    (item.exitCode === undefined && item.timedOut === undefined)
  )
    return (
      <Badge variant="outline" className="gap-1.5 text-[11px] text-faint">
        <m.span
          className="size-1.5 rounded-full bg-primary"
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.2, repeat: Number.POSITIVE_INFINITY }}
        />
        running
      </Badge>
    );
  if (item.timedOut)
    return (
      <Badge
        variant="outline"
        className="border-warning/30 text-[11px] font-medium text-warning"
      >
        timed out
      </Badge>
    );
  if (item.exitCode === 0)
    return (
      <Badge
        variant="outline"
        className="border-positive/30 text-[11px] font-medium text-positive"
      >
        exit 0
      </Badge>
    );
  if (item.exitCode === null || item.exitCode === undefined)
    return (
      <Badge variant="destructive" className="text-[11px] font-medium">
        terminated
      </Badge>
    );
  return (
    <Badge variant="destructive" className="text-[11px] font-medium">
      exit {item.exitCode}
    </Badge>
  );
}

/// Renders a run_command tool item: a terminal-styled card with the command in
/// the header and its live-streamed combined output below, open by default so
/// the user can watch it run. Distinct from the collapsible ToolCall card.
export function CommandCard({ item }: { item: TranscriptItem }) {
  const command = useMemo(() => commandFromArgs(item.args), [item.args]);
  const output = item.result?.replace(/\n+$/, "");

  return (
    <m.div
      variants={rise}
      initial="initial"
      animate="animate"
      className="mb-2.5"
    >
      <ToolCard>
        <div className="flex w-full items-center gap-2.5 px-3 py-2">
          <span className="grid size-5 shrink-0 place-items-center rounded-md bg-primary/10 text-primary-soft">
            <TerminalIcon size={13} />
          </span>
          <span className="text-[12px] font-medium text-foreground">Run</span>
          <span className="truncate font-mono text-[12px] text-muted-foreground">
            {command}
          </span>
          <span className="ml-auto shrink-0">
            <StatusChip item={item} />
          </span>
        </div>
        {output ? (
          <div className="border-t border-border-soft">
            <pre className="scrollbar-thin max-h-72 overflow-auto px-3 py-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {output}
            </pre>
          </div>
        ) : null}
      </ToolCard>
    </m.div>
  );
}
