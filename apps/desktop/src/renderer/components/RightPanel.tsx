import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import type { WorkspaceChange } from "@nexus/protocol";
import type { FileContents } from "@pierre/diffs/react";
import {
  FileTree as TreesFileTree,
  useFileTree,
  useFileTreeSelection,
} from "@pierre/trees/react";
import { m } from "motion/react";
import {
  lazy,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { basename } from "../lib/format";
import type { EditorTab, SelectedFile } from "../lib/types";
import {
  ChevronRightIcon,
  CloseIcon,
  FileIcon,
  FolderOpenIcon,
  PanelRightIcon,
  PlusIcon,
} from "./Icons";
import { Hint } from "./Tooltip";

const DiffFile = lazy(() =>
  import("@pierre/diffs/react").then(({ File }) => ({ default: File })),
);
const PatchDiff = lazy(() =>
  import("@pierre/diffs/react").then(({ PatchDiff: Component }) => ({
    default: Component,
  })),
);

const TREE_THEME = [
  "[--trees-bg-override:transparent]",
  "[--trees-fg-override:var(--color-foreground)]",
  "[--trees-fg-muted-override:var(--color-muted)]",
  "[--trees-border-color-override:var(--color-border)]",
  "[--trees-selected-bg-override:var(--color-secondary)]",
  "[--trees-selected-fg-override:var(--color-foreground)]",
  "[--trees-accent-override:var(--color-primary)]",
  "[--trees-focus-ring-color-override:var(--color-primary)]",
  "[--trees-search-bg-override:var(--color-muted)]",
  "[--trees-search-fg-override:var(--color-foreground)]",
  "[--trees-scrollbar-thumb-override:var(--color-scroll-thumb)]",
  "[--trees-indent-guide-bg-override:var(--color-border-soft)]",
  "[--trees-theme-list-hover-bg:var(--color-accent)]",
  "[--trees-theme-input-bg:var(--color-muted)]",
  "[--trees-theme-input-fg:var(--color-foreground)]",
  "[--trees-theme-input-border:var(--color-border)]",
].join(" ");

export function RightPanel({
  tabs,
  activeTabId,
  activeTab,
  activeContent,
  files,
  changes,
  codeTheme,
  workspaceName,
  treeVisible,
  treeWidth,
  onOpenFile,
  onNewTab,
  onCloseTab,
  onActivateTab,
  onToggleTree,
  onResizeStart,
  onResizeKeyDown,
  onTreeResizeStart,
  onTreeResizeKeyDown,
}: {
  tabs: EditorTab[];
  activeTabId?: string;
  activeTab?: EditorTab;
  activeContent?: SelectedFile;
  files: string[];
  changes: WorkspaceChange[];
  codeTheme: "pierre-light" | "pierre-dark";
  workspaceName: string;
  treeVisible: boolean;
  treeWidth: number;
  onOpenFile: (path: string) => void;
  onNewTab: () => void;
  onCloseTab: (id: string) => void;
  onActivateTab: (id: string) => void;
  onToggleTree: () => void;
  onResizeStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onResizeKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  onTreeResizeStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onTreeResizeKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
}) {
  const { model } = useFileTree({
    id: "workspace-file-tree",
    paths: [],
    icons: "standard",
    initialExpansion: 1,
    density: "compact",
    flattenEmptyDirectories: true,
    search: true,
    fileTreeSearchMode: "hide-non-matches",
  });
  const selectedPaths = useFileTreeSelection(model);
  const [view, setView] = useState<"code" | "changes">("code");
  const onOpenRef = useRef(onOpenFile);
  const lastSelectedPathRef = useRef<string | undefined>(undefined);

  const activePath = activeTab?.path;
  const content = activeContent?.content;
  const loading = activeContent?.loading;
  const file = useMemo<FileContents | undefined>(
    () =>
      activePath && content !== undefined && !loading
        ? {
            name: activePath,
            contents: content,
            cacheKey: `${activePath}:${content.length}`,
          }
        : undefined,
    [activePath, content, loading],
  );

  useEffect(() => {
    model.resetPaths(files);
  }, [files, model]);
  useEffect(() => {
    onOpenRef.current = onOpenFile;
  }, [onOpenFile]);
  useEffect(() => {
    model.setGitStatus(
      changes.map((change) => ({
        path: change.path,
        status: change.status === "conflicted" ? "modified" : change.status,
      })),
    );
  }, [changes, model]);
  useEffect(() => {
    const path = selectedPaths.at(-1);
    const item = path ? model.getItem(path) : undefined;
    if (
      path &&
      path !== lastSelectedPathRef.current &&
      item &&
      !item.isDirectory()
    ) {
      lastSelectedPathRef.current = path;
      onOpenRef.current(path);
    }
  }, [model, selectedPaths]);

  const hasPatch = Boolean(activeContent?.patch.trim());
  const segments = activePath ? activePath.split("/") : [];

  return (
    <m.aside
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      style={{ gridColumn: 3 }}
      className="relative flex h-screen min-h-0 flex-col overflow-hidden border-l border-border bg-panel"
    >
      <button
        type="button"
        aria-label="Resize panel"
        className="absolute inset-y-0 left-0 z-20 w-2 cursor-col-resize touch-none focus-visible:bg-primary/25 focus-visible:outline-none"
        onPointerDown={onResizeStart}
        onKeyDown={onResizeKeyDown}
      />

      {/* Tab bar */}
      <div className="app-drag flex h-11 shrink-0 items-start gap-1 border-b border-border-soft px-2 pt-[6px] pr-[var(--corner-controls,0px)]">
        <div className="scrollbar-thin app-no-drag flex flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                className={`group flex shrink-0 items-center gap-1 rounded-lg pr-1 pl-2 ${
                  active ? "bg-secondary" : "hover:bg-accent"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onActivateTab(tab.id)}
                  className={`flex items-center gap-1.5 py-1.5 text-[12px] ${
                    active ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  <FileIcon size={13} className="text-muted-foreground" />
                  <span className="max-w-[140px] truncate">
                    {tab.path ? basename(tab.path) : "Open file"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onCloseTab(tab.id)}
                  aria-label="Close tab"
                  className="grid size-4 place-items-center rounded text-faint opacity-0 transition group-hover:opacity-100 hover:text-foreground"
                >
                  <CloseIcon size={11} />
                </button>
              </div>
            );
          })}
          <Hint label="New tab">
            <button
              type="button"
              onClick={onNewTab}
              aria-label="New tab"
              className="grid size-6 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <PlusIcon size={15} />
            </button>
          </Hint>
        </div>
      </div>

      {/* Breadcrumb + controls */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border-soft px-3">
        <div className="scrollbar-thin flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-[11px] text-muted-foreground">
          <span className="shrink-0 truncate">{workspaceName}</span>
          {segments.map((segment, index) => (
            <span
              key={segments.slice(0, index + 1).join("/")}
              className="flex shrink-0 items-center gap-1"
            >
              <ChevronRightIcon size={11} className="text-faint" />
              <span
                className={
                  index === segments.length - 1 ? "text-foreground" : undefined
                }
              >
                {segment}
              </span>
            </span>
          ))}
        </div>
        {hasPatch ? (
          <ToggleGroup
            value={[view]}
            onValueChange={(groupValue) => {
              const next = groupValue[0] as "code" | "changes" | undefined;
              if (next) setView(next);
            }}
            className="flex shrink-0 rounded-lg border border-border-soft p-0.5 text-[10px]"
          >
            <Toggle
              value="code"
              className="rounded-md px-2 py-0.5 font-medium text-faint transition hover:text-muted-foreground data-[pressed]:bg-secondary data-[pressed]:text-primary-soft"
            >
              Code
            </Toggle>
            <Toggle
              value="changes"
              className="rounded-md px-2 py-0.5 font-medium text-faint transition hover:text-muted-foreground data-[pressed]:bg-secondary data-[pressed]:text-primary-soft"
            >
              Changes
            </Toggle>
          </ToggleGroup>
        ) : null}
        <Hint
          label={treeVisible ? "Hide file tree" : "Show file tree"}
          side="left"
        >
          <button
            type="button"
            onClick={onToggleTree}
            aria-label={treeVisible ? "Hide file tree" : "Show file tree"}
            aria-pressed={treeVisible}
            className={`grid size-6 shrink-0 place-items-center rounded-lg transition ${
              treeVisible
                ? "bg-secondary text-primary-soft"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            <PanelRightIcon size={15} />
          </button>
        </Hint>
      </div>

      {/* Body: editor | divider | tree */}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-hidden bg-background">
          <Editor
            activePath={activePath}
            activeContent={activeContent}
            file={file}
            view={hasPatch ? view : "code"}
            codeTheme={codeTheme}
          />
        </div>
        {treeVisible ? (
          <>
            <button
              type="button"
              aria-label="Resize file tree"
              className="w-1.5 shrink-0 cursor-col-resize touch-none bg-transparent transition hover:bg-primary/25 focus-visible:bg-primary/25 focus-visible:outline-none"
              onPointerDown={onTreeResizeStart}
              onKeyDown={onTreeResizeKeyDown}
            />
            <div
              style={{ width: treeWidth }}
              className="flex min-h-0 shrink-0 flex-col overflow-hidden border-l border-border-soft"
            >
              <TreesFileTree
                model={model}
                className={`scrollbar-thin min-h-0 flex-1 px-1 pt-1 ${TREE_THEME}`}
                aria-label="Workspace files"
              />
            </div>
          </>
        ) : null}
      </div>
    </m.aside>
  );
}

function Editor({
  activePath,
  activeContent,
  file,
  view,
  codeTheme,
}: {
  activePath?: string;
  activeContent?: SelectedFile;
  file?: FileContents;
  view: "code" | "changes";
  codeTheme: "pierre-light" | "pierre-dark";
}) {
  if (!activePath)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <FolderOpenIcon size={26} className="text-faint" />
        <div>
          <p className="text-[13px] font-medium text-foreground">Open file</p>
          <p className="mt-0.5 text-[12px] text-faint">
            Select a file from the workspace tree.
          </p>
        </div>
      </div>
    );
  if (!activeContent || activeContent.loading || !file)
    return (
      <div className="p-4 text-[12px] text-faint">Loading {activePath}…</div>
    );
  const showChanges = view === "changes" && Boolean(activeContent.patch.trim());
  return (
    <div className="scrollbar-thin h-full overflow-auto overscroll-contain">
      <Suspense
        fallback={
          <p className="p-4 text-[12px] text-faint">Loading code renderer…</p>
        }
      >
        {showChanges ? (
          <PatchDiff
            patch={activeContent.patch}
            options={{
              theme: codeTheme,
              diffStyle: "unified",
              overflow: "scroll",
              disableFileHeader: true,
            }}
          />
        ) : (
          <DiffFile
            file={file}
            options={{
              theme: codeTheme,
              overflow: "scroll",
              disableFileHeader: true,
            }}
          />
        )}
      </Suspense>
      {activeContent.truncated ? (
        <p className="px-3 pb-3 text-[10px] text-warning">
          Preview truncated at 120 KB.
        </p>
      ) : null}
    </div>
  );
}
