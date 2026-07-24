import { Menu } from "@base-ui/react/menu";
import { useState } from "react";
import { ChevronDownIcon, GitBranchIcon } from "./Icons";

/// The composer branch chip: shows the current git branch and, on click, a
/// popover to check out another local branch.
export function BranchMenu({
  branch,
  branches,
  onSwitch,
  onCreate,
  onDelete,
  onRename,
}: {
  branch: string;
  branches: string[];
  onSwitch: (name: string) => void;
  onCreate: (name: string) => Promise<boolean>;
  onDelete: (name: string) => Promise<boolean>;
  onRename: (from: string, to: string) => Promise<boolean>;
}) {
  const others = branches.filter((item) => item !== branch);
  const [newBranch, setNewBranch] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string>();

  async function create() {
    const name = newBranch.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      if (await onCreate(name)) setNewBranch("");
    } finally {
      setCreating(false);
    }
  }

  async function remove(name: string) {
    if (deleting || !window.confirm(`Delete merged branch ${name}?`)) return;
    setDeleting(name);
    try {
      await onDelete(name);
    } finally {
      setDeleting(undefined);
    }
  }

  async function rename(name: string) {
    const next = window.prompt("Rename branch", name)?.trim();
    if (!next || next === name) return;
    await onRename(name, next);
  }

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
                <span className="min-w-0 flex-1 truncate">{item}</span>
                <button
                  type="button"
                  disabled={Boolean(deleting)}
                  onClick={(event) => {
                    event.stopPropagation();
                    void rename(item);
                  }}
                  className="rounded px-1 text-[10px] text-faint hover:bg-secondary hover:text-foreground disabled:opacity-50"
                  aria-label={`Rename ${item}`}
                >
                  Rename
                </button>
                <button
                  type="button"
                  disabled={Boolean(deleting)}
                  onClick={(event) => {
                    event.stopPropagation();
                    void remove(item);
                  }}
                  className="rounded px-1 text-[10px] text-faint hover:bg-secondary hover:text-destructive disabled:opacity-50"
                  aria-label={`Delete ${item}`}
                >
                  {deleting === item ? "…" : "Delete"}
                </button>
              </Menu.Item>
            ))}
            {others.length === 0 ? (
              <p className="px-3 py-1.5 text-[12px] text-faint">
                No other branches
              </p>
            ) : null}
            <form
              className="mt-1 border-t border-border-soft px-2 pt-2 pb-1"
              onSubmit={(event) => {
                event.preventDefault();
                void create();
              }}
            >
              <label className="sr-only" htmlFor="new-branch-name">
                New branch name
              </label>
              <div className="flex gap-1">
                <input
                  id="new-branch-name"
                  value={newBranch}
                  onChange={(event) => setNewBranch(event.target.value)}
                  placeholder="New branch name"
                  spellCheck={false}
                  className="min-w-0 flex-1 rounded border border-border-soft bg-background px-2 py-1 text-[11px] text-foreground outline-none placeholder:text-faint focus:border-primary-dim"
                />
                <button
                  type="submit"
                  disabled={creating || !newBranch.trim()}
                  className="rounded bg-secondary px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  {creating ? "Creating…" : "Create"}
                </button>
              </div>
            </form>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
