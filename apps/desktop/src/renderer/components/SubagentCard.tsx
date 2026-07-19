import type { TranscriptItem } from "@nexus/protocol";
import { m } from "motion/react";
import { useMemo } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { rise } from "../lib/motion";
import { describeToolCall } from "../lib/toolPresentation";
import { ChevronRightIcon, CompassIcon } from "./Icons";
import { toolCardClass } from "./ToolCard";

/// Renders a spawn_agent call as a research sub-agent card: the task in the
/// header, the read-only steps it has taken streamed live below, and its final
/// answer behind a collapsible once it returns. A sub-agent is read-only, so
/// there's no approval affordance — just progress and a result.
export function SubagentCard({ item }: { item: TranscriptItem }) {
  const p = useMemo(() => describeToolCall(item), [item]);
  const steps = item.subagentSteps ?? [];
  const done = Boolean(item.result);

  return (
    <m.div
      variants={rise}
      initial="initial"
      animate="animate"
      className="mb-2.5"
    >
      <div className={toolCardClass}>
        <div className="flex w-full items-center gap-2.5 px-3 py-2 text-left">
          <span className="grid size-5 shrink-0 place-items-center rounded-md bg-primary/10 text-primary-soft">
            <CompassIcon size={13} />
          </span>
          <span className="shrink-0 text-[12px] font-medium text-foreground">
            {p.verb}
          </span>
          {p.target ? (
            <span className="truncate text-[12px] text-muted-foreground">
              {p.target}
            </span>
          ) : null}
          {!done ? (
            <span className="ml-auto shrink-0 text-[11px] text-faint">
              working…
            </span>
          ) : null}
        </div>

        {steps.length > 0 ? (
          <ul className="border-t border-border-soft px-3 py-2">
            {steps.map((step, index) => (
              <li
                // Steps are append-only and never reordered, so the index is a
                // stable key here.
                // biome-ignore lint/suspicious/noArrayIndexKey: append-only log
                key={index}
                className="flex items-baseline gap-2 py-0.5 font-mono text-[11px] text-muted-foreground"
              >
                <span className="text-faint">·</span>
                <span className="truncate">{step}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {done ? (
          <Collapsible className="border-t border-border-soft">
            <CollapsibleTrigger className="group flex w-full items-center gap-2.5 px-3 py-2 text-left outline-none hover:bg-secondary/60">
              <span className="text-[11px] font-medium text-foreground">
                Result
              </span>
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
        ) : null}
      </div>
    </m.div>
  );
}
