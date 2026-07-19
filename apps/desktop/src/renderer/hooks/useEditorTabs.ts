import { useEffect, useState } from "react";
import { createId } from "../lib/format";
import type { EditorTab, SelectedFile } from "../lib/types";

/// Owns the open-file tabs and a per-path content cache for the editor pane.
/// Reuses the same two-stage IPC as the old single-file preview: `previewFile`
/// first, then `workspaceDiff` fills in the patch.
export function useEditorTabs(
  workspacePath: string | undefined,
  reportError: (message: string) => void,
) {
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>();
  const [contents, setContents] = useState<Record<string, SelectedFile>>({});

  // A new workspace starts with a clean editor.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset whenever the workspace changes
  useEffect(() => {
    setTabs([]);
    setActiveTabId(undefined);
    setContents({});
  }, [workspacePath]);

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const activeContent = activeTab?.path ? contents[activeTab.path] : undefined;

  async function loadContent(path: string) {
    setContents((current) => ({
      ...current,
      [path]: {
        path,
        content: "",
        patch: "",
        truncated: false,
        loading: true,
      },
    }));
    try {
      const preview = await window.nexus.previewFile(path);
      setContents((current) => ({
        ...current,
        [path]: { ...preview, patch: "", loading: false },
      }));
      void window.nexus.workspaceDiff(path).then((patch) => {
        setContents((current) =>
          current[path]
            ? { ...current, [path]: { ...current[path], patch } }
            : current,
        );
      });
    } catch (reason) {
      setContents((current) => {
        const next = { ...current };
        delete next[path];
        return next;
      });
      reportError(
        reason instanceof Error ? reason.message : "Could not open this file.",
      );
    }
  }

  function openFile(path: string) {
    const existing = tabs.find((tab) => tab.path === path);
    if (existing) {
      setActiveTabId(existing.id);
    } else {
      const active = tabs.find((tab) => tab.id === activeTabId);
      if (active && !active.path) {
        // Fill the empty active tab in place.
        setTabs((current) =>
          current.map((tab) => (tab.id === active.id ? { ...tab, path } : tab)),
        );
        setActiveTabId(active.id);
      } else {
        // Open a new tab and focus it.
        const tab: EditorTab = { id: createId(), path };
        setTabs((current) => [...current, tab]);
        setActiveTabId(tab.id);
      }
    }
    if (!contents[path]) void loadContent(path);
  }

  function newTab() {
    const tab: EditorTab = { id: createId() };
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
  }

  function closeTab(id: string) {
    setTabs((current) => {
      const index = current.findIndex((tab) => tab.id === id);
      if (index === -1) return current;
      const next = current.filter((tab) => tab.id !== id);
      if (id === activeTabId)
        setActiveTabId(next[index]?.id ?? next[index - 1]?.id);
      return next;
    });
  }

  function activateTab(id: string) {
    setActiveTabId(id);
  }

  function resetTabs() {
    setTabs([]);
    setActiveTabId(undefined);
    setContents({});
  }

  return {
    tabs,
    activeTabId,
    activeTab,
    activeContent,
    openFile,
    newTab,
    closeTab,
    activateTab,
    resetTabs,
  };
}
