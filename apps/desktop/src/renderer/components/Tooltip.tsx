import type { ReactElement, ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider as UiTooltipProvider,
} from "@/components/ui/tooltip";

type Side = "top" | "bottom" | "left" | "right";

/// A styled tooltip that attaches to an existing interactive element. Unlike a
/// native `title`, it appears on keyboard focus, is themed, and shares a single
/// hover delay via the app-level `TooltipProvider`. Wrap the trigger directly:
///
///   <Hint label="New task (⌘N)"><button …>{icon}</button></Hint>
///
/// `children` must be a single focusable element — Base UI merges the trigger
/// props (and aria wiring) onto it via `render`. Thin shim over ui/tooltip so
/// call sites keep this API while the popup styling is shadcn's.
export function Hint({
  label,
  children,
  side = "bottom",
}: {
  label: ReactNode;
  children: ReactElement;
  side?: Side;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent
        side={side}
        sideOffset={6}
        // The arrow (always the popup's last element child) is hidden: it is
        // tinted for shadcn's inverted tooltip, which this bordered popover
        // styling replaces.
        className="border border-border bg-popover px-2 py-1 text-[11px] font-medium text-foreground shadow-[var(--shadow-pop)] [&>*:last-child]:hidden"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/// Shares one open-delay and hover-grouping across every `Hint`. Mount once near
/// the app root.
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <UiTooltipProvider delay={400}>{children}</UiTooltipProvider>;
}
