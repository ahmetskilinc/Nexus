import type { AppState } from "@nexus/protocol";
import {
  type AppOp,
  addSession,
  openWorkspace,
  selectSession,
} from "../lib/ops";
import { newSession } from "../lib/session";

/// Session/workspace CRUD: open a repository, switch sessions, start a new task.
/// `resetView` clears the file/diff panel when the active workspace changes.
export function useSessions(
  state: AppState | undefined,
  apply: (op: AppOp) => void,
  resetView: () => void,
) {
  function openNewWorkspace(nextPath: string) {
    if (!state) return;
    apply(openWorkspace(nextPath, newSession(nextPath)));
    resetView();
  }

  async function chooseWorkspace(): Promise<boolean> {
    try {
      const nextPath = await window.nexus.chooseWorkspace();
      if (!nextPath) return false;
      openNewWorkspace(nextPath);
      return true;
    } catch {
      return false;
    }
  }

  async function cloneWorkspace(url: string): Promise<boolean> {
    try {
      const nextPath = await window.nexus.cloneWorkspace(url);
      if (!nextPath) return false;
      openNewWorkspace(nextPath);
      return true;
    } catch {
      return false;
    }
  }

  function select(id: string) {
    if (!state) return;
    const session = state.sessions.find((item) => item.id === id);
    if (!session) return;
    apply(selectSession(id));
    if (session.workspacePath !== state.workspacePath) resetView();
  }

  function createSession() {
    if (!state) return;
    if (!state.workspacePath) {
      void chooseWorkspace();
      return;
    }
    apply(addSession(newSession(state.workspacePath)));
  }

  return {
    chooseWorkspace,
    cloneWorkspace,
    selectSession: select,
    createSession,
  };
}
