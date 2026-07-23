import { Collapsible } from "@base-ui/react/collapsible";
import { Drawer } from "@base-ui/react/drawer";
import { Input } from "@base-ui/react/input";
import { Menu } from "@base-ui/react/menu";
import type { Session } from "@nexus/protocol";
import { m, useReducedMotion } from "motion/react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useState,
} from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { createId, relativeTime } from "../lib/format";
import {
  type AppOp,
  archiveSession,
  deleteSession,
  deleteSessions,
  duplicateSession,
  openSessionInSplit,
  renameSession,
  togglePinSession,
} from "../lib/ops";
import type { WorkspaceSummary } from "../lib/types";
import {
  ChevronRightIcon,
  ComposeIcon,
  FolderIcon,
  FolderOpenIcon,
  MoreHorizontalIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  SelectIcon,
} from "./Icons";
import {
  SidebarBrandMark,
  SidebarFooter,
  SidebarHeader,
  SidebarNavRow,
} from "./sidebar";
import { Hint } from "./Tooltip";

type WorkspaceGroup = { workspace: WorkspaceSummary; sessions: Session[] };

type LeftNavProps = {
  groups: WorkspaceGroup[];
  activeWorkspacePath?: string;
  currentSessionId?: string;
  sideSessionId?: string;
  apply: (op: AppOp) => void;
  onNewTask: () => void;
  onOpenWorkspace: () => void;
  onImportSession: () => void;
  onSelectSession: (id: string) => void;
  onOpenSettings: () => void;
};

const MENU_POPUP =
  "z-50 w-44 origin-[var(--transform-origin)] overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-[var(--shadow-pop)] outline-none transition duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0";
const MENU_ITEM =
  "flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-[12px] text-muted-foreground outline-none data-[highlighted]:bg-accent data-[highlighted]:text-foreground";

/// The shared sidebar body — brand header, new-task row, session search,
/// projects tree (with per-session pin/rename/delete), and footer. Rendered
/// inside the docked `LeftNav` (wide viewports) and the `LeftNavDrawer`
/// overlay (narrow viewports) so both stay in lockstep.
function LeftNavContent({
  groups,
  activeWorkspacePath,
  currentSessionId,
  sideSessionId,
  apply,
  onNewTask,
  onOpenWorkspace,
  onImportSession,
  onSelectSession,
  onOpenSettings,
}: LeftNavProps) {
  const reduce = useReducedMotion();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ id: string; draft: string }>();
  const [deleteTarget, setDeleteTarget] = useState<Session>();
  // Multi-select: `selecting` swaps every row into a checkbox; `selected` holds
  // the ticked ids across all workspaces. `confirmingBatch` gates the shared
  // delete dialog into its batch wording.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmingBatch, setConfirmingBatch] = useState(false);

  // Sync-to-prop: when the parent makes a workspace active, ensure its group is
  // expanded. Deliberately an effect, not an event handler — the discriminator is
  // a parent-owned prop and `collapsed` is local view state the user can still
  // toggle afterward. Lifting it to the parent would add coupling for no benefit.
  useEffect(() => {
    if (!activeWorkspacePath) return;
    setCollapsed((current) => {
      if (!current.has(activeWorkspacePath)) return current;
      const next = new Set(current);
      next.delete(activeWorkspacePath);
      return next;
    });
  }, [activeWorkspacePath]);

  function toggle(path: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function commitRename() {
    if (!editing) return;
    const title = editing.draft.trim();
    if (title)
      apply(renameSession(editing.id, title, new Date().toISOString()));
    setEditing(undefined);
  }

  function startSelect(id: string) {
    setEditing(undefined);
    setSelected(new Set([id]));
    setSelecting(true);
  }

  function toggleCheck(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function cancelSelect() {
    setSelecting(false);
    setSelected(new Set());
  }

  // Title search: while filtering, groups without matches disappear and the
  // collapse state is ignored (a filter that hides its results is a lie).
  const q = query.trim().toLowerCase();
  const visible = q
    ? groups
        .map(({ workspace, sessions }) => ({
          workspace,
          sessions: sessions.filter((session) =>
            session.title.toLowerCase().includes(q),
          ),
        }))
        .filter(({ sessions }) => sessions.length > 0)
    : groups;

  return (
    <>
      <SidebarHeader lead={<SidebarBrandMark />} />

      <div className="flex flex-col gap-1 px-2.5 pb-1">
        <SidebarNavRow
          icon={<ComposeIcon size={17} />}
          title="New task (⌘N)"
          onClick={onNewTask}
        >
          New task
        </SidebarNavRow>
      </div>

      <div className="px-3 pt-2">
        <div className="flex items-center gap-2 rounded-lg border border-border-soft bg-muted/60 px-2.5 py-1.5 focus-within:border-primary-dim">
          <SearchIcon size={13} className="shrink-0 text-faint" />
          <Input
            value={query}
            onValueChange={(value) => setQuery(value)}
            placeholder="Search chats"
            aria-label="Search chats"
            className="w-full bg-transparent text-[12px] text-foreground outline-none placeholder:text-faint"
          />
        </div>
      </div>

      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="text-[10px] font-semibold tracking-[0.13em] text-faint uppercase">
          Projects
        </span>
        <div className="flex items-center gap-0.5">
          <Hint label="Import session">
            <button
              type="button"
              aria-label="Import session"
              onClick={onImportSession}
              className="grid size-5 place-items-center rounded text-[12px] font-semibold text-faint transition hover:bg-accent hover:text-foreground"
            >
              ↥
            </button>
          </Hint>
          <Hint label="Open a repository">
            <button
              type="button"
              aria-label="Open a repository"
              onClick={onOpenWorkspace}
              className="grid size-5 place-items-center rounded text-faint transition hover:bg-accent hover:text-foreground"
            >
              <PlusIcon size={14} />
            </button>
          </Hint>
        </div>
      </div>

      {selecting ? (
        <div className="mx-3 mt-1 flex items-center justify-between gap-2 rounded-lg border border-border-soft bg-muted/60 px-2.5 py-1.5">
          <span className="text-[12px] font-medium text-muted-foreground tabular-nums">
            {selected.size} selected
          </span>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={cancelSelect}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={selected.size === 0}
              onClick={() => setConfirmingBatch(true)}
            >
              Delete
            </Button>
          </div>
        </div>
      ) : null}

      <nav className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
        {groups.length === 0 ? (
          <button
            type="button"
            onClick={onOpenWorkspace}
            className="rounded-lg px-2.5 py-2 text-left text-[12px] text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            Open a repository to begin
          </button>
        ) : visible.length === 0 ? (
          <p className="px-2.5 py-2 text-[12px] text-faint">
            No chats match “{query.trim()}”.
          </p>
        ) : (
          visible.map(({ workspace, sessions }) => {
            const open = q ? true : !collapsed.has(workspace.path);
            const isActiveWorkspace = workspace.path === activeWorkspacePath;
            return (
              <Collapsible.Root
                key={workspace.path}
                open={open}
                onOpenChange={() => toggle(workspace.path)}
              >
                <Collapsible.Trigger
                  title={workspace.path}
                  className="group flex w-full items-center gap-1.5 rounded-lg px-2 py-2 text-left outline-none transition hover:bg-accent"
                >
                  <ChevronRightIcon
                    size={14}
                    className={`shrink-0 text-faint transition-transform ${open ? "rotate-90" : ""}`}
                  />
                  {open ? (
                    <FolderOpenIcon
                      size={15}
                      className={
                        isActiveWorkspace ? "text-primary-soft" : "text-faint"
                      }
                    />
                  ) : (
                    <FolderIcon
                      size={15}
                      className={
                        isActiveWorkspace ? "text-primary-soft" : "text-faint"
                      }
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                    {workspace.name}
                  </span>
                  <span className="font-mono text-[10px] text-faint tabular-nums">
                    {sessions.length}
                  </span>
                </Collapsible.Trigger>

                <Collapsible.Panel
                  className={`overflow-hidden ${reduce ? "" : "h-[var(--collapsible-panel-height)] transition-[height] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] data-[starting-style]:h-0 data-[ending-style]:h-0"}`}
                >
                  <div className="mt-0.5 mb-1 flex flex-col gap-0.5">
                    {sessions.length === 0 ? (
                      <p className="py-1 pl-9 text-[11px] text-faint">
                        No chats yet
                      </p>
                    ) : (
                      sessions.map((session) =>
                        editing?.id === session.id ? (
                          <input
                            key={session.id}
                            // biome-ignore lint/a11y/noAutofocus: the row just switched into edit mode at the user's request
                            autoFocus
                            value={editing.draft}
                            onFocus={(event) => event.target.select()}
                            onChange={(event) =>
                              setEditing({
                                id: session.id,
                                draft: event.target.value,
                              })
                            }
                            onBlur={() => setEditing(undefined)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") commitRename();
                              if (event.key === "Escape") setEditing(undefined);
                            }}
                            className="rounded-lg border border-primary-dim bg-muted px-2.5 py-[6px] text-[12.5px] text-foreground outline-none"
                          />
                        ) : (
                          <SessionRow
                            key={session.id}
                            session={session}
                            active={
                              session.id === currentSessionId ||
                              session.id === sideSessionId
                            }
                            isCurrent={session.id === currentSessionId}
                            selecting={selecting}
                            checked={selected.has(session.id)}
                            onToggleCheck={() => toggleCheck(session.id)}
                            onStartSelect={() => startSelect(session.id)}
                            onSelect={() => onSelectSession(session.id)}
                            onOpenInSplit={(side) =>
                              apply(openSessionInSplit(session.id, side))
                            }
                            onPin={() => apply(togglePinSession(session.id))}
                            onDuplicate={() =>
                              apply(
                                duplicateSession(
                                  session.id,
                                  createId(),
                                  new Date().toISOString(),
                                ),
                              )
                            }
                            onArchive={() =>
                              apply(
                                archiveSession(
                                  session.id,
                                  new Date().toISOString(),
                                ),
                              )
                            }
                            onExport={() => exportSession(session)}
                            onRename={() =>
                              setEditing({
                                id: session.id,
                                draft: session.title,
                              })
                            }
                            onDelete={() => setDeleteTarget(session)}
                          />
                        ),
                      )
                    )}
                  </div>
                </Collapsible.Panel>
              </Collapsible.Root>
            );
          })
        )}
      </nav>

      <SidebarFooter onSettings={onOpenSettings} />

      <AlertDialog
        open={Boolean(deleteTarget) || confirmingBatch}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(undefined);
            setConfirmingBatch(false);
          }
        }}
      >
        <AlertDialogContent size="sm">
          {confirmingBatch ? (
            <>
              <AlertDialogTitle>
                Delete {selected.size} {selected.size === 1 ? "chat" : "chats"}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {selected.size === 1 ? "1 chat" : `${selected.size} chats`} and
                their transcripts will be removed. This cannot be undone.
              </AlertDialogDescription>
            </>
          ) : (
            <>
              <AlertDialogTitle>Delete chat?</AlertDialogTitle>
              <AlertDialogDescription>
                “{deleteTarget?.title}” and its transcript will be removed. This
                cannot be undone.
              </AlertDialogDescription>
            </>
          )}
          <AlertDialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDeleteTarget(undefined);
                setConfirmingBatch(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (confirmingBatch) {
                  apply(deleteSessions([...selected]));
                  setConfirmingBatch(false);
                  cancelSelect();
                } else if (deleteTarget) {
                  apply(deleteSession(deleteTarget.id));
                  setDeleteTarget(undefined);
                }
              }}
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/// One session row: the select button plus a hover-revealed "…" menu (pin /
/// rename / delete). The timestamp yields its spot to the menu on hover so the
/// row width never jumps.
function SessionRow({
  session,
  active,
  isCurrent,
  selecting,
  checked,
  onToggleCheck,
  onStartSelect,
  onSelect,
  onOpenInSplit,
  onPin,
  onDuplicate,
  onArchive,
  onExport,
  onRename,
  onDelete,
}: {
  session: Session;
  /// Highlighted: shown in either the primary or the side pane.
  active: boolean;
  /// The focused pane's session — the one row that can't open into a split.
  isCurrent: boolean;
  /// Multi-select mode: the row becomes a checkbox and hides its "…" menu.
  selecting: boolean;
  checked: boolean;
  onToggleCheck: () => void;
  onStartSelect: () => void;
  onSelect: () => void;
  onOpenInSplit: (side: "left" | "right") => void;
  onPin: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onExport: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  // In select mode the row shows a checkbox; the title is a `<label>` bound to
  // it via `htmlFor`, so clicking anywhere on the row toggles the tick.
  if (selecting) {
    const checkboxId = `select-${session.id}`;
    return (
      <div
        className={`group flex items-center gap-2 rounded-lg px-2.5 py-[7px] transition ${
          checked ? "bg-accent" : "hover:bg-accent"
        }`}
      >
        <Checkbox
          id={checkboxId}
          checked={checked}
          onCheckedChange={onToggleCheck}
          aria-label={`Select ${session.title}`}
        />
        <label
          htmlFor={checkboxId}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5"
        >
          {session.pinned ? (
            <PinIcon size={11} className="shrink-0 text-faint" />
          ) : null}
          <span
            className={`min-w-0 flex-1 truncate text-[12.5px] ${
              checked
                ? "font-medium text-foreground"
                : "text-muted-foreground group-hover:text-foreground"
            }`}
          >
            {session.title}
          </span>
        </label>
      </div>
    );
  }

  return (
    <div
      className={`group relative flex items-center rounded-lg transition ${
        active ? "bg-accent" : "hover:bg-accent"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-[7px] text-left outline-none"
      >
        {session.pinned ? (
          <PinIcon size={11} className="shrink-0 text-faint" />
        ) : null}
        <span
          className={`min-w-0 flex-1 truncate text-[12.5px] ${
            active
              ? "font-medium text-foreground"
              : "text-muted-foreground group-hover:text-foreground"
          }`}
        >
          {session.title}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-faint tabular-nums group-focus-within:hidden group-hover:hidden">
          {relativeTime(session.updatedAt)}
        </span>
      </button>
      <Menu.Root>
        <Menu.Trigger
          aria-label={`Actions for ${session.title}`}
          className="mr-1 hidden size-5 shrink-0 cursor-pointer place-items-center rounded text-faint outline-none transition hover:text-foreground focus-visible:grid group-focus-within:grid group-hover:grid data-[popup-open]:grid data-[popup-open]:text-foreground"
        >
          <MoreHorizontalIcon size={14} />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner
            side="bottom"
            align="start"
            sideOffset={4}
            className="z-50"
          >
            <Menu.Popup className={MENU_POPUP}>
              {!isCurrent ? (
                <>
                  <Menu.Item
                    closeOnClick
                    className={MENU_ITEM}
                    onClick={() => onOpenInSplit("left")}
                  >
                    <PanelLeftIcon size={13} />
                    Open to the left
                  </Menu.Item>
                  <Menu.Item
                    closeOnClick
                    className={MENU_ITEM}
                    onClick={() => onOpenInSplit("right")}
                  >
                    <PanelRightIcon size={13} />
                    Open to the right
                  </Menu.Item>
                </>
              ) : null}
              <Menu.Item closeOnClick className={MENU_ITEM} onClick={onPin}>
                <PinIcon size={13} />
                {session.pinned ? "Unpin" : "Pin"}
              </Menu.Item>
              <Menu.Item
                closeOnClick
                className={MENU_ITEM}
                onClick={onDuplicate}
              >
                Duplicate
              </Menu.Item>
              <Menu.Item closeOnClick className={MENU_ITEM} onClick={onArchive}>
                Archive
              </Menu.Item>
              <Menu.Item closeOnClick className={MENU_ITEM} onClick={onExport}>
                Export
              </Menu.Item>
              <Menu.Item closeOnClick className={MENU_ITEM} onClick={onRename}>
                Rename
              </Menu.Item>
              <Menu.Item
                closeOnClick
                className={MENU_ITEM}
                onClick={onStartSelect}
              >
                <SelectIcon size={13} />
                Select
              </Menu.Item>
              <div className="my-1 border-t border-border-soft" />
              <Menu.Item
                closeOnClick
                className={`${MENU_ITEM} text-destructive data-[highlighted]:text-destructive`}
                onClick={onDelete}
              >
                Delete
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}

function exportSession(session: Session) {
  const blob = new Blob([JSON.stringify({ version: 1, session }, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${
    session.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "nexus-session"
  }.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/// The docked sidebar: a real grid column (wide viewports). Owns the drag-to-
/// resize handle; the body is the shared `LeftNavContent`.
export function LeftNav({
  onResizeStart,
  onResizeKeyDown,
  ...content
}: LeftNavProps & {
  onResizeStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onResizeKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
}) {
  return (
    <m.aside
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      style={{ gridColumn: 1 }}
      className="relative flex h-screen min-h-0 flex-col overflow-hidden border-r border-border bg-sidebar"
    >
      <LeftNavContent {...content} />

      <button
        type="button"
        aria-label="Resize sidebar"
        className="absolute inset-y-0 right-0 z-20 w-2 cursor-col-resize touch-none focus-visible:bg-primary/25 focus-visible:outline-none"
        onPointerDown={onResizeStart}
        onKeyDown={onResizeKeyDown}
      />
    </m.aside>
  );
}

/// The overlay sidebar: a Base UI Drawer that slides in from the left edge
/// (narrow viewports) with a backdrop and swipe-to-dismiss. Selecting a session
/// or starting a task dismisses it so the chat isn't left covered.
export function LeftNavDrawer({
  open,
  onOpenChange,
  onSelectSession,
  onNewTask,
  onOpenSettings,
  ...content
}: LeftNavProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const dismiss = () => onOpenChange(false);
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} swipeDirection="left">
      <Drawer.Portal>
        <Drawer.Backdrop className="fixed inset-0 z-40 bg-black opacity-[calc(0.4*(1-var(--drawer-swipe-progress)))] transition-opacity duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-[swiping]:duration-0 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
        <Drawer.Viewport className="fixed inset-0 z-40 flex items-stretch justify-start">
          <Drawer.Popup className="flex h-full w-[284px] max-w-[85vw] flex-col border-r border-border bg-sidebar outline-none [transform:translateX(var(--drawer-swipe-movement-x))] transition-transform duration-[450ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-[swiping]:select-none data-[starting-style]:[transform:translateX(-100%)] data-[ending-style]:[transform:translateX(-100%)]">
            <Drawer.Title className="sr-only">Navigation</Drawer.Title>
            <LeftNavContent
              {...content}
              onSelectSession={(id) => {
                onSelectSession(id);
                dismiss();
              }}
              onNewTask={() => {
                onNewTask();
                dismiss();
              }}
              onOpenSettings={() => {
                onOpenSettings();
                dismiss();
              }}
            />
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
