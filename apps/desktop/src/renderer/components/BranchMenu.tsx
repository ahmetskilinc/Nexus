import { Menu } from "@base-ui/react/menu";
import { ChevronDownIcon, GitBranchIcon } from "./Icons";

/// The composer branch chip: shows the current git branch and, on click, a
/// popover to check out another local branch.
export function BranchMenu({
  branch,
  branches,
  onSwitch,
}: {
  branch: string;
  branches: string[];
  onSwitch: (name: string) => void;
}) {
  const others = branches.filter((item) => item !== branch);

  return (
    <Menu.Root>
      <Menu.Trigger
        title="Switch branch"
        className="flex items-center gap-1.5 rounded-lg py-0.5 pr-1 pl-0.5 text-muted-foreground transition outline-none hover:text-foreground data-[popup-open]:text-foreground"
      >
        <GitBranchIcon size={13} />
        <span className="max-w-[160px] truncate">{branch}</span>
        <ChevronDownIcon size={11} className="text-faint" />
      </Menu.Trigger>

      <Menu.Portal>
        <Menu.Positioner
          side="top"
          align="start"
          sideOffset={8}
          className="z-50"
        >
          <Menu.Popup className="scrollbar-thin max-h-64 w-60 origin-[var(--transform-origin)] overflow-y-auto rounded-lg border border-border bg-popover py-1 shadow-[var(--shadow-pop)] transition duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0 outline-none">
            <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold tracking-[0.1em] text-faint uppercase">
              Switch branch
            </div>
            <Menu.Item
              closeOnClick
              className="flex cursor-default items-center justify-between gap-2 px-3 py-1.5 text-left text-[12px] text-foreground outline-none select-none data-[highlighted]:bg-accent"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <GitBranchIcon size={12} />
                <span className="truncate">{branch}</span>
              </span>
              <span className="size-1.5 shrink-0 rounded-full bg-primary" />
            </Menu.Item>
            {others.map((item) => (
              <Menu.Item
                key={item}
                onClick={() => onSwitch(item)}
                className="flex cursor-default items-center gap-1.5 px-3 py-1.5 text-left text-[12px] text-muted-foreground outline-none transition select-none data-[highlighted]:bg-accent data-[highlighted]:text-foreground"
              >
                <GitBranchIcon size={12} className="text-faint" />
                <span className="truncate">{item}</span>
              </Menu.Item>
            ))}
            {others.length === 0 ? (
              <p className="px-3 py-1.5 text-[12px] text-faint">
                No other branches
              </p>
            ) : null}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
