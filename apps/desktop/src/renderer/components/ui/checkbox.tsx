import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";

import { cn } from "@/lib/utils";
import { CheckIcon } from "../Icons";

/// A compact checkbox styled with the app's tokens. Renders the check indicator
/// only when checked. Kept minimal — just what the session rows need.
function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded border border-border bg-muted text-primary-foreground outline-none transition focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-[checked]:border-primary data-[checked]:bg-primary",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex data-[unchecked]:hidden">
        <CheckIcon size={11} strokeWidth={2.4} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
