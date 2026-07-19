import type * as React from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/// The one tool-card surface every transcript card renders into (tool calls,
/// commands, todos, fenced code) — previously a per-file CARD string kept "in
/// lockstep" by comment; now in lockstep by construction.
export const toolCardClass =
  "flex flex-col overflow-hidden rounded-lg border border-border-soft bg-card/50 text-sm text-card-foreground";

/// shadcn Card constrained to the tool-card look: hairline border instead of
/// the default ring, no built-in padding/gap (rows own their spacing).
export function ToolCard({
  className,
  ...props
}: React.ComponentProps<typeof Card>) {
  return (
    <Card
      className={cn(toolCardClass, "gap-0 py-0 ring-0", className)}
      {...props}
    />
  );
}
