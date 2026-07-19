import type {
  AppState,
  Memory,
  ModelInfo,
  RuntimeEvent,
  StartAgentParams,
  WorkspaceChange,
} from "@nexus/protocol";
import { contextBridge, ipcRenderer } from "electron";

const api = {
  platform: process.platform,
  appVersion: () => ipcRenderer.invoke("app:version") as Promise<string>,
  loadState: () => ipcRenderer.invoke("state:load") as Promise<AppState>,
  saveState: (state: AppState) =>
    ipcRenderer.invoke("state:save", state) as Promise<AppState>,
  chooseWorkspace: () =>
    ipcRenderer.invoke("workspace:choose") as Promise<string | undefined>,
  indexWorkspace: () =>
    ipcRenderer.invoke("workspace:index") as Promise<string[]>,
  previewFile: (relativePath: string) =>
    ipcRenderer.invoke("workspace:preview", relativePath) as Promise<{
      path: string;
      content: string;
      truncated: boolean;
    }>,
  workspaceChanges: () =>
    ipcRenderer.invoke("workspace:changes") as Promise<WorkspaceChange[]>,
  gitBranch: () =>
    ipcRenderer.invoke("workspace:git") as Promise<{ branch?: string }>,
  listBranches: () =>
    ipcRenderer.invoke("workspace:branches") as Promise<string[]>,
  switchBranch: (name: string) =>
    ipcRenderer.invoke("workspace:checkout", name) as Promise<{
      branch: string;
    }>,
  workspaceDiff: (relativePath: string) =>
    ipcRenderer.invoke("workspace:diff", relativePath) as Promise<string>,
  stageFiles: (paths: string[]) =>
    ipcRenderer.invoke("workspace:stage", paths) as Promise<void>,
  unstageFiles: (paths: string[]) =>
    ipcRenderer.invoke("workspace:unstage", paths) as Promise<void>,
  commitChanges: (message: string) =>
    ipcRenderer.invoke("workspace:commit", message) as Promise<void>,
  discardFile: (relativePath: string) =>
    ipcRenderer.invoke("workspace:discard", relativePath) as Promise<void>,
  restoreCheckpoint: (checkpointId: string, paths?: string[]) =>
    ipcRenderer.invoke("checkpoint:restore", checkpointId, paths) as Promise<
      string[]
    >,
  contextPreview: () =>
    ipcRenderer.invoke("context:preview") as Promise<{
      instructionSource?: string;
      instructionText?: string;
      instructionTruncated: boolean;
      memories: Memory[];
    }>,
  listMemories: () => ipcRenderer.invoke("memory:list") as Promise<Memory[]>,
  deleteMemory: (id: string) =>
    ipcRenderer.invoke("memory:delete", id) as Promise<void>,
  clearMemories: () => ipcRenderer.invoke("memory:clear") as Promise<void>,
  health: () =>
    ipcRenderer.invoke("runtime:health") as Promise<Record<string, unknown>>,
  listModels: (providerId: string) =>
    ipcRenderer.invoke("runtime:models", providerId) as Promise<ModelInfo[]>,
  verifyProvider: (providerId: string, kind: string, auth: string) =>
    ipcRenderer.invoke(
      "runtime:provider:verify",
      providerId,
      kind,
      auth,
    ) as Promise<ModelInfo[]>,
  setCredential: (providerId: string, value: string) =>
    ipcRenderer.invoke("runtime:credential:set", providerId, value),
  deleteCredential: (providerId: string) =>
    ipcRenderer.invoke("runtime:credential:delete", providerId),
  startAgent: (params: StartAgentParams) =>
    ipcRenderer.invoke("runtime:agent", params) as Promise<string>,
  cancelAgent: (runId: string) => ipcRenderer.invoke("runtime:cancel", runId),
  approveEdit: (runId: string, callId: string, approved: boolean) =>
    ipcRenderer.invoke("runtime:approve", runId, callId, approved),
  signIn: (providerId: string, providerKind: string) =>
    ipcRenderer.invoke("oauth:signin", providerId, providerKind) as Promise<
      Record<string, unknown>
    >,
  onRuntimeEvent: (
    listener: (payload: { runId: string; event: RuntimeEvent }) => void,
  ) => {
    const callback = (
      _: Electron.IpcRendererEvent,
      payload: { runId: string; event: RuntimeEvent },
    ) => listener(payload);
    ipcRenderer.on("runtime:event", callback);
    return () => ipcRenderer.removeListener("runtime:event", callback);
  },
  onRuntimeFinished: (
    listener: (payload: {
      runId: string;
      result: Record<string, unknown>;
    }) => void,
  ) => {
    const callback = (
      _: Electron.IpcRendererEvent,
      payload: { runId: string; result: Record<string, unknown> },
    ) => listener(payload);
    ipcRenderer.on("runtime:finished", callback);
    return () => ipcRenderer.removeListener("runtime:finished", callback);
  },
  onRuntimeFailed: (
    listener: (payload: {
      runId: string;
      message: string;
      cancelled: boolean;
    }) => void,
  ) => {
    const callback = (
      _: Electron.IpcRendererEvent,
      payload: { runId: string; message: string; cancelled: boolean },
    ) => listener(payload);
    ipcRenderer.on("runtime:failed", callback);
    return () => ipcRenderer.removeListener("runtime:failed", callback);
  },
  // Terminal: one shell per workspace, spawned in the main process. Data flows
  // main→renderer via the `terminal:data` event; input/resize go the other way.
  spawnTerminal: (cols: number, rows: number) =>
    ipcRenderer.invoke("terminal:spawn", cols, rows) as Promise<{
      ok: boolean;
      error?: string;
    }>,
  writeTerminal: (data: string) => ipcRenderer.send("terminal:input", data),
  resizeTerminal: (cols: number, rows: number) =>
    ipcRenderer.send("terminal:resize", cols, rows),
  killTerminal: () => ipcRenderer.invoke("terminal:kill"),
  onTerminalData: (
    listener: (payload: { workspacePath: string; data: string }) => void,
  ) => {
    const callback = (
      _: Electron.IpcRendererEvent,
      payload: { workspacePath: string; data: string },
    ) => listener(payload);
    ipcRenderer.on("terminal:data", callback);
    return () => ipcRenderer.removeListener("terminal:data", callback);
  },
  onTerminalExit: (listener: (payload: { workspacePath: string }) => void) => {
    const callback = (
      _: Electron.IpcRendererEvent,
      payload: { workspacePath: string },
    ) => listener(payload);
    ipcRenderer.on("terminal:exit", callback);
    return () => ipcRenderer.removeListener("terminal:exit", callback);
  },
};

contextBridge.exposeInMainWorld("nexus", api);

export type NexusApi = typeof api;
