import type { BranchSync, WorkspaceChange } from "@nexus/protocol";
import { useEffect, useRef, useState } from "react";

const NO_SYNC: BranchSync = {
  branch: null,
  upstream: null,
  ahead: 0,
  behind: 0,
  hasRemote: false,
};

/// Owns workspace file-index + git-change state and branch info. File *contents*
/// (the editor tabs) live in `useEditorTabs`.
export function useWorkspaceFiles(
  workspacePath: string | undefined,
  reportError: (message: string) => void,
  syncState?: () => Promise<unknown>,
) {
  const [files, setFiles] = useState<string[]>([]);
  const [changes, setChanges] = useState<WorkspaceChange[]>([]);
  const [branch, setBranch] = useState<string>();
  const [branches, setBranches] = useState<string[]>([]);
  const [sync, setSync] = useState<BranchSync>(NO_SYNC);
  // Ref so the effect below can flush the *latest* state without re-running
  // (and re-fetching branches) on every unrelated state change.
  const syncStateRef = useRef(syncState);
  syncStateRef.current = syncState;

  useEffect(() => {
    // A workspace switch (sidebar select or pane focus) invalidates the index
    // and diffs immediately — never show another repo's files.
    setFiles([]);
    setChanges([]);
    setSync(NO_SYNC);
    if (!workspacePath) {
      setBranch(undefined);
      setBranches([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      // The main process resolves workspace IPC against its persisted store,
      // which only learns of this workspacePath via the debounced state save.
      // Flush first, or the one-shot branch fetch races the save and sticks
      // empty until the next workspace switch.
      await syncStateRef.current?.().catch(() => {});
      if (cancelled) return;
      void window.nexus
        .gitBranch()
        .then(({ branch: next }) => {
          if (!cancelled) setBranch(next);
        })
        .catch(() => {
          if (!cancelled) setBranch(undefined);
        });
      void window.nexus
        .listBranches()
        .then((list) => {
          if (!cancelled) setBranches(list);
        })
        .catch(() => {
          if (!cancelled) setBranches([]);
        });
      void window.nexus
        .branchSync()
        .then((next) => {
          if (!cancelled) setSync(next);
        })
        .catch(() => {
          if (!cancelled) setSync(NO_SYNC);
        });
    })();
    return () => {
      cancelled = true;
    };
  }, [workspacePath]);

  async function createBranch(name: string): Promise<boolean> {
    try {
      const { branch: next } = await window.nexus.createBranch(name);
      setBranch(next);
      setFiles([]);
      setChanges([]);
      const branches = await window.nexus.listBranches();
      setBranches(branches);
      await Promise.all([refreshSync(), reloadFiles()]);
      return true;
    } catch (reason) {
      reportError(
        reason instanceof Error ? reason.message : "Could not create branch.",
      );
      return false;
    }
  }

  async function renameBranch(from: string, to: string): Promise<boolean> {
    try {
      const { branch: next } = await window.nexus.renameBranch(from, to);
      if (branch === from) setBranch(next);
      setBranches(await window.nexus.listBranches());
      await refreshSync();
      return true;
    } catch (reason) {
      reportError(
        reason instanceof Error ? reason.message : "Could not rename branch.",
      );
      return false;
    }
  }

  async function deleteBranch(name: string): Promise<boolean> {
    try {
      await window.nexus.deleteBranch(name);
      setBranches(await window.nexus.listBranches());
      return true;
    } catch (reason) {
      reportError(
        reason instanceof Error ? reason.message : "Could not delete branch.",
      );
      return false;
    }
  }

  async function switchBranch(name: string) {
    try {
      await window.nexus.switchBranch(name);
      setBranch(name);
      // The working tree changed — invalidate the file index and diffs, then
      // re-index right away so an open file panel repopulates for the new
      // branch instead of going blank (nothing else reloads it: the
      // workspace-change effect only fires on workspace switches).
      setFiles([]);
      setChanges([]);
      void window.nexus
        .listBranches()
        .then(setBranches)
        .catch(() => {});
      void refreshSync();
      await reloadFiles();
    } catch (reason) {
      reportError(
        reason instanceof Error ? reason.message : "Could not switch branch.",
      );
    }
  }

  /// Ahead/behind counts only move on commit, push, or branch switch, so this
  /// is refreshed at those points rather than alongside every file refresh.
  async function refreshSync() {
    try {
      setSync(await window.nexus.branchSync());
    } catch {
      setSync(NO_SYNC);
    }
  }

  async function fetchRemotes(): Promise<boolean> {
    try {
      setSync(await window.nexus.fetchRemotes());
      return true;
    } catch (reason) {
      reportError(
        reason instanceof Error ? reason.message : "Could not fetch remotes.",
      );
      return false;
    }
  }

  async function pullCommits(): Promise<boolean> {
    try {
      setSync(await window.nexus.pullCommits());
      await reloadFiles();
      return true;
    } catch (reason) {
      reportError(
        reason instanceof Error ? reason.message : "Could not pull commits.",
      );
      await refreshSync();
      return false;
    }
  }

  async function pushCommits(): Promise<boolean> {
    try {
      setSync(await window.nexus.pushCommits());
      return true;
    } catch (reason) {
      reportError(
        reason instanceof Error ? reason.message : "Could not push commits.",
      );
      // The push may have failed midway (rejected, network); re-read the truth.
      await refreshSync();
      return false;
    }
  }

  async function refreshChanges() {
    try {
      setChanges(await window.nexus.workspaceChanges());
    } catch (reason) {
      reportError(
        reason instanceof Error
          ? reason.message
          : "Could not refresh workspace changes.",
      );
    }
  }

  async function stageFiles(paths: string[]) {
    try {
      await window.nexus.stageFiles(paths);
      await refreshChanges();
    } catch (reason) {
      reportError(
        reason instanceof Error ? reason.message : "Could not stage files.",
      );
    }
  }

  async function unstageFiles(paths: string[]) {
    try {
      await window.nexus.unstageFiles(paths);
      await refreshChanges();
    } catch (reason) {
      reportError(
        reason instanceof Error ? reason.message : "Could not unstage files.",
      );
    }
  }

  async function discardFile(path: string) {
    try {
      await window.nexus.discardFile(path);
      await refreshChanges();
    } catch (reason) {
      reportError(
        reason instanceof Error
          ? reason.message
          : "Could not discard file changes.",
      );
    }
  }

  async function commitChanges(message: string): Promise<boolean> {
    try {
      await window.nexus.commitChanges(message);
      await Promise.all([refreshChanges(), refreshSync()]);
      return true;
    } catch (reason) {
      reportError(
        reason instanceof Error ? reason.message : "Could not create commit.",
      );
      return false;
    }
  }

  /// Clears the file index (panel open state is reset by the caller).
  function resetFiles() {
    setFiles([]);
    setChanges([]);
  }

  async function loadFiles() {
    try {
      const [nextFiles, nextChanges] = await Promise.all([
        files.length ? Promise.resolve(files) : window.nexus.indexWorkspace(),
        window.nexus.workspaceChanges(),
      ]);
      setFiles(nextFiles);
      setChanges(nextChanges);
      // An agent run (or an external commit) may have moved HEAD.
      void refreshSync();
    } catch (reason) {
      reportError(
        reason instanceof Error
          ? reason.message
          : "Could not load workspace files.",
      );
    }
  }

  /// Re-indexes unconditionally — for when the workspace switches underneath
  /// an open panel (pane focus), where `loadFiles`'s cached index would lie.
  async function reloadFiles() {
    try {
      const [nextFiles, nextChanges] = await Promise.all([
        window.nexus.indexWorkspace(),
        window.nexus.workspaceChanges(),
      ]);
      setFiles(nextFiles);
      setChanges(nextChanges);
      // An agent run (or an external commit) may have moved HEAD.
      void refreshSync();
    } catch (reason) {
      reportError(
        reason instanceof Error
          ? reason.message
          : "Could not load workspace files.",
      );
    }
  }

  return {
    files,
    changes,
    branch,
    branches,
    sync,
    switchBranch,
    createBranch,
    renameBranch,
    deleteBranch,
    fetchRemotes,
    pullCommits,
    pushCommits,
    refreshSync,
    stageFiles,
    unstageFiles,
    commitChanges,
    discardFile,
    refreshChanges,
    resetFiles,
    loadFiles,
    reloadFiles,
  };
}
