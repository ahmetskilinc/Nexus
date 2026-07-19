import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import type { Ref, UIEventHandler } from "react";
import { cn } from "@/lib/utils";

/// Overlay-scrollbar scroll container: unlike a native `overflow-y: auto`
/// scrollbar, the Base UI scrollbar floats above the content and consumes no
/// layout width, so centered content stays truly centered.
function ScrollArea({
  className,
  viewportClassName,
  viewportRef,
  onViewportScroll,
  children,
  ...props
}: ScrollAreaPrimitive.Root.Props & {
  viewportClassName?: string;
  /// The scrollable element (scrollTop/scrollHeight/scrollTo live here).
  viewportRef?: Ref<HTMLDivElement>;
  onViewportScroll?: UIEventHandler<HTMLDivElement>;
}) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        ref={viewportRef}
        onScroll={onViewportScroll}
        className={cn(
          "size-full rounded-[inherit] outline-none",
          viewportClassName,
        )}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

/// Sized to match the legacy `.scrollbar-thin` look: a 9px gutter with a
/// pill thumb inset 2px on either side.
function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        // No z-index: as a later sibling of the viewport it already paints
        // above the content, and it must stay under floating chrome (the
        // composer, scroll fades) that sits at z-10 in the same context.
        "flex touch-none select-none",
        orientation === "vertical" && "w-[9px] px-0.5 py-px",
        orientation === "horizontal" && "h-[9px] flex-col px-px py-0.5",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-scroll-thumb transition-colors hover:bg-scroll-thumb-hover"
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
}

export { ScrollArea, ScrollBar };
