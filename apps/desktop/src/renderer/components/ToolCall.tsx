import type { TranscriptItem } from "@nexus/protocol";
import { m } from "motion/react";
import { useMemo } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { rise } from "../lib/motion";
import {
  describeToolCall,
  type ToolPresentation,
} from "../lib/toolPresentation";
import { ChevronRightIcon } from "./Icons";
import { ToolCard, toolCardClass } from "./ToolCard";

const ROW = "flex w-full items-center gap-2.5 px-3 py-2 text-left";

function HeaderContent({ p }: { p: ToolPresentation }) {
  return (
    <>
      <span className="grid size-5 shrink-0 place-items-center rounded-md bg-primary/10 text-primary-soft">
        <p.Icon size={13} />
      </span>
      <span className="text-[12px] font-medium text-foreground">{p.verb}</span>
      {p.target ? (
        <span className="truncate font-mono text-[12px] text-muted-foreground">
          {p.target}
        </span>
      ) : null}
      {p.meta ? (
        <span className="shrink-0 font-mono text-[11px] text-faint">
          {p.meta}
        </span>
      ) : null}
    </>
  );
}

export function ToolCall({ item }: { item: TranscriptItem }) {
  const p = useMemo(() => describeToolCall(item), [item]);
  const hasResult = Boolean(item.result);
  // Status results (edits) are short enough to always show inline; content
  // results (files, searches) hide behind a Collapsible so the transcript stays
  // calm — Base UI gives us the trigger semantics and aria wiring for free.
  const collapsible = hasResult && p.bodyKind === "content";
  const showInlineStatus = hasResult && p.bodyKind === "status";

  const card = collapsible ? (
    // The Collapsible root is itself the card surface, so it takes the shared
    // class rather than nesting inside a ToolCard.
    <Collapsible className={toolCardClass}>
      <CollapsibleTrigger
        className={`${ROW} group cursor-pointer outline-none hover:bg-secondary/60`}
      >
        <HeaderContent p={p} />
        <span className="ml-auto shrink-0 text-faint transition-transform duration-150 group-data-[panel-open]:rotate-90 motion-reduce:transition-none">
          <ChevronRightIcon size={14} />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="h-[var(--collapsible-panel-height)] overflow-hidden border-t border-border-soft transition-[height] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] data-[ending-style]:h-0 data-[starting-style]:h-0 motion-reduce:transition-none">
        <pre className="scrollbar-thin max-h-72 overflow-auto px-3 py-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {item.result}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  ) : (
    <ToolCard>
      <div className={ROW}>
        <HeaderContent p={p} />
      </div>
      {showInlineStatus ? (
        <div className="border-t border-border-soft px-3 py-2 font-mono text-[11px] text-muted-foreground">
          {item.result}
        </div>
      ) : null}
    </ToolCard>
  );

  return (
    <m.div
      variants={rise}
      initial="initial"
      animate="animate"
      className="mb-2.5"
    >
      {card}
    </m.div>
  );
}
