import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  AppState,
  CompactAgentParams,
  ModelInfo,
  StartAgentParams,
} from "@nexus/protocol";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  safeStorage,
  session,
  shell,
  utilityProcess,
} from "electron";
import { loginShellEnvironment } from "./environment";
import { type RuntimeChild, RuntimeClient } from "./runtime";
import { forkInProcessRuntime } from "./runtime-inprocess";
import { handleSecretsRequest } from "./secrets";
import { Store } from "./store";
import { TerminalManager } from "./terminal";

const execFileAsync = promisify(execFile);

async function isGitRepository(workspace: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      { cwd: workspace, timeout: 3000 },
    );
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

async function gitBranch(workspace: string) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd: workspace, timeout: 2000 },
    );
    const branch = stdout.trim();
    return branch && branch !== "HEAD" ? branch : undefined;
  } catch {
    return undefined;
  }
}

const store = new Store();

/// Forks the TS runtime as a utilityProcess: crash-isolated like the old
/// sidecar, but the code ships inside the asar (integrity-fused) and the IPC
/// is typed structured-clone instead of NDJSON. stdout/stderr are piped into
/// the main-process log under the old sidecar's prefix.
function forkRuntime(): RuntimeChild {
  const child = utilityProcess.fork(
    path.join(__dirname, "../runtime/index.js"),
    [],
    {
      serviceName: "nexus-runtime",
      stdio: "pipe",
      env: loginShellEnvironment(),
    },
  );
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) =>
    console.error("[nexus-runtime]", chunk.trimEnd()),
  );
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) =>
    console.error("[nexus-runtime]", chunk.trimEnd()),
  );
  // Lifecycle diagnostics: a runtime that dies before its first message is
  // otherwise invisible (failAll rejects silently in the renderer).
  child.on("spawn", () => console.error("[nexus-runtime] process spawned"));
  child.on("exit", (code) =>
    console.error(`[nexus-runtime] process exited (code ${code})`),
  );
  return child;
}

const runtime = new RuntimeClient({
  fork: forkRuntime,
  // Signed packaged builds currently hit an Electron/Chromium Mach-rendezvous
  // validation bug on recent macOS: the utility process boots but its IPC
  // channel never connects. When the handshake times out, the same runtime
  // core is hosted in-process instead (crash isolation lost, nothing else).
  forkFallback: forkInProcessRuntime,
  readyTimeoutMs: 3_000,
  init: () => ({
    credentialsDir: path.join(app.getPath("userData"), "credentials"),
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    appVersion: app.getVersion(),
  }),
  onHostRequest: handleSecretsRequest,
});

/// The renderer's own origin: the built files over file:// when packaged, the
/// Vite dev server otherwise. Used to lock navigation and scope the CSP.
const DEV_ORIGIN = "http://127.0.0.1:5173";

let mainWindow: BrowserWindow | undefined;
const terminals = new TerminalManager(() => mainWindow);

/// Confines the renderer to its own origin. Untrusted content (model output,
/// repo diffs, file previews) is rendered here, so a navigation away — or a
/// window it tries to open — must never load a remote page that would inherit
/// the privileged `window.nexus` bridge the preload attaches on every load.
/// External links are handed to the OS browser instead.
function lockNavigation(contents: Electron.WebContents) {
  const isAppUrl = (url: string) => {
    if (app.isPackaged) return url.startsWith("file://");
    return url.startsWith(`${DEV_ORIGIN}/`) || url === DEV_ORIGIN;
  };
  const guard = (event: Electron.Event, url: string) => {
    if (!isAppUrl(url)) event.preventDefault();
  };
  contents.on("will-navigate", guard);
  contents.on("will-redirect", guard);
  contents.setWindowOpenHandler(({ url }) => {
    // Open genuine external links in the user's browser, never in-app.
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" || parsed.protocol === "http:")
        void shell.openExternal(url);
    } catch {
      // Ignore malformed URLs.
    }
    return { action: "deny" };
  });
}

/// Installs a strict Content-Security-Policy on every response so an HTML or
/// script injection through rendered untrusted content cannot execute code or
/// exfiltrate data. Dev additionally allows the Vite server + its HMR socket.
function installContentSecurityPolicy() {
  const dev = app.isPackaged ? "" : ` ${DEV_ORIGIN} ws://127.0.0.1:5173`;
  // Vite's dev client and React Fast Refresh inject an inline module preamble
  // and evaluate modules dynamically, so dev needs 'unsafe-inline'/'unsafe-eval'
  // for scripts. Production stays strict: 'self' only, no inline, no eval.
  const scriptDev = app.isPackaged ? "" : " 'unsafe-inline' 'unsafe-eval'";
  const csp = [
    "default-src 'self'",
    `script-src 'self'${dev}${scriptDev}`,
    `connect-src 'self'${dev}`,
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    // Not covered by default-src: without it an injected <form> could still
    // POST rendered content to an external origin.
    "form-action 'none'",
  ].join("; ");
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
      },
    });
  });
}

/// Brand icon for unpackaged runs. Packaged builds get their icon from the
/// bundle (electron-builder stamps build/icon.icns into the .app and the .ico
/// into the Windows exe), but `electron .` during development otherwise shows
/// the stock Electron logo — so dev loads the same PNG by hand.
const DEV_ICON = path.join(__dirname, "../../build/icon.png");

function createWindow(state: AppState) {
  const preference = state.theme ?? "system";
  // Let the native vibrancy material follow the app's chosen theme rather than
  // the OS appearance, so a light-app-on-dark-OS user doesn't get dark glass.
  nativeTheme.themeSource = preference;
  const dark =
    preference === "dark" ||
    (preference === "system" && nativeTheme.shouldUseDarkColors);
  const isMac = process.platform === "darwin";
  mainWindow = new BrowserWindow({
    width: state.windowBounds?.width ?? 1200,
    height: state.windowBounds?.height ?? 780,
    x: state.windowBounds?.x,
    y: state.windowBounds?.y,
    minWidth: 960,
    minHeight: 640,
    titleBarStyle: isMac ? "hiddenInset" : "default",
    // macOS takes its icon from the dock (set below), not the window.
    icon: !app.isPackaged && !isMac ? DEV_ICON : undefined,
    // Pin the traffic lights so their dot centers line up with the custom
    // toolbar icons (glyph center ≈ 20.5px). Electron's default inset drifted
    // across versions; x stays tight so the green dot clears the panel toggle
    // pinned at left-[70px].
    trafficLightPosition: isMac ? { x: 12, y: 13 } : undefined,
    // On macOS the sidebar column is painted by a native vibrancy view; the
    // window itself is transparent so the material shows through. Elsewhere we
    // keep an opaque background (no vibrancy support).
    vibrancy: isMac ? "sidebar" : undefined,
    visualEffectState: "active",
    backgroundColor: isMac ? "#00000000" : dark ? "#0a0b0d" : "#f6f7f9",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  lockNavigation(mainWindow.webContents);
  mainWindow.on("close", () => {
    const current = store.snapshot();
    void store.save({ ...current, windowBounds: mainWindow?.getBounds() });
  });
  if (app.isPackaged)
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  else void mainWindow.loadURL("http://127.0.0.1:5173");
}

function requireWorkspace(candidate: string, state: AppState) {
  if (!state.workspacePath || candidate !== state.workspacePath)
    throw new Error("This request is outside the selected workspace.");
  return candidate;
}

function profileById(state: AppState, providerId: string) {
  const profile = state.providers.find((item) => item.id === providerId);
  if (!profile) throw new Error("Provider profile was not found.");
  return profile;
}

function registerIpc() {
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("state:load", () => store.snapshot());
  ipcMain.handle("state:save", (_event, state: AppState) => store.save(state));
  ipcMain.handle("workspace:choose", async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose a repository",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return undefined;
    const workspace = await realpath(result.filePaths[0]);
    if (!(await isGitRepository(workspace)))
      throw new Error("Choose a Git repository, not an ordinary folder.");
    return workspace;
  });

  ipcMain.handle("workspace:clone", async (_event, url: string) => {
    const trimmed = url.trim();
    if (!trimmed) throw new Error("A repository URL is required.");
    // Git accepts local paths as clone sources too, but workspace onboarding
    // deliberately accepts only SSH and HTTPS remotes. The URL remains one
    // inert execFile argument, never shell text.
    if (!/^(https:\/\/[^\s]+|git@[\w.-]+:[\w./-]+(?:\.git)?)$/.test(trimmed))
      throw new Error("Enter a valid HTTPS or SSH repository URL.");
    const destination = await dialog.showOpenDialog({
      title: "Choose a folder for the cloned repository",
      properties: ["openDirectory", "createDirectory"],
    });
    if (destination.canceled || !destination.filePaths[0]) return undefined;
    const parent = await realpath(destination.filePaths[0]);
    const name = trimmed
      .replace(/\/$/, "")
      .split(/[/:]/)
      .at(-1)
      ?.replace(/\.git$/, "");
    if (!name || !/^[\w.-]+$/.test(name))
      throw new Error("Could not determine a safe repository folder name.");
    const target = path.join(parent, name);
    try {
      await execFileAsync("git", ["clone", "--", trimmed, target], {
        timeout: 120_000,
        env: { ...loginShellEnvironment(), GIT_TERMINAL_PROMPT: "0" },
      });
      const workspace = await realpath(target);
      if (!(await isGitRepository(workspace)))
        throw new Error("Git clone completed without creating a working tree.");
      return workspace;
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : String(reason);
      throw new Error(`Git could not clone this repository: ${detail}`);
    }
  });
  ipcMain.handle("workspace:index", async () => {
    const state = store.snapshot();
    const workspacePath = requireWorkspace(state.workspacePath ?? "", state);
    const { response } = runtime.request("workspace.index", {
      path: workspacePath,
    });
    return (await response).files as string[];
  });
  ipcMain.handle("workspace:preview", async (_event, relativePath: string) => {
    const state = store.snapshot();
    const workspacePath = requireWorkspace(state.workspacePath ?? "", state);
    const absolute = path.resolve(workspacePath, relativePath);
    const relative = path.relative(workspacePath, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("File is outside the selected workspace.");
    const [canonicalWorkspace, canonicalFile] = await Promise.all([
      realpath(workspacePath),
      realpath(absolute),
    ]);
    if (!canonicalFile.startsWith(`${canonicalWorkspace}${path.sep}`))
      throw new Error("File resolves outside the selected workspace.");
    const data = await readFile(canonicalFile);
    if (data.subarray(0, 8192).includes(0))
      return {
        path: relativePath,
        content: "This is a binary file; its content cannot be displayed.",
        truncated: false,
      };
    const truncated = data.length > 120000;
    return {
      path: relativePath,
      content:
        data.subarray(0, 120000).toString("utf8") +
        (truncated ? "\n\n[Preview truncated]" : ""),
      truncated,
    };
  });
  ipcMain.handle("workspace:project-map", async () => {
    const state = store.snapshot();
    const workspacePath = requireWorkspace(state.workspacePath ?? "", state);
    const { response } = runtime.request("workspace.projectMap", {
      path: workspacePath,
    });
    return (await response).map;
  });
  ipcMain.handle("workspace:search", async (_event, query: string) => {
    const state = store.snapshot();
    const workspacePath = requireWorkspace(state.workspacePath ?? "", state);
    const { response } = runtime.request("workspace.search", {
      path: workspacePath,
      query,
    });
    const result = await response;
    return Array.isArray(result.matches) ? result.matches : [];
  });
  ipcMain.handle("workspace:changes", async () => {
    const state = store.snapshot();
    const workspacePath = requireWorkspace(state.workspacePath ?? "", state);
    try {
      const { response } = runtime.request("workspace.changes", {
        path: workspacePath,
      });
      return (await response).changes;
    } catch {
      // Git decorations are optional; keep the file explorer available while a
      // development sidecar is being rebuilt or Git is unavailable.
      return [];
    }
  });
  ipcMain.handle("workspace:git", async () => {
    const state = store.snapshot();
    if (!state.workspacePath) return {};
    return { branch: await gitBranch(state.workspacePath) };
  });
  ipcMain.handle("workspace:branches", async () => {
    const state = store.snapshot();
    if (!state.workspacePath) return [];
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["branch", "--format=%(refname:short)", "--sort=-committerdate"],
        { cwd: state.workspacePath, timeout: 3000 },
      );
      return stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  });
  ipcMain.handle("workspace:create-branch", async (_event, name: string) => {
    const state = store.snapshot();
    const workspacePath = requireWorkspace(state.workspacePath ?? "", state);
    await runtime.request("workspace.createBranch", {
      path: workspacePath,
      name,
    }).response;
    return { branch: name };
  });
  ipcMain.handle(
    "workspace:rename-branch",
    async (_event, from: string, to: string) => {
      const state = store.snapshot();
      const workspacePath = requireWorkspace(state.workspacePath ?? "", state);
      await runtime.request("workspace.renameBranch", {
        path: workspacePath,
        from,
        to,
      }).response;
      return { branch: to };
    },
  );
  ipcMain.handle("workspace:delete-branch", async (_event, name: string) => {
    const state = store.snapshot();
    const workspacePath = requireWorkspace(state.workspacePath ?? "", state);
    await runtime.request("workspace.deleteBranch", {
      path: workspacePath,
      name,
    }).response;
  });
  ipcMain.handle("workspace:checkout", async (_event, name: string) => {
    const state = store.snapshot();
    if (!state.workspacePath) throw new Error("No workspace is selected.");
    await runtime.request("workspace.switchBranch", {
      path: state.workspacePath,
      name,
    }).response;
    return { branch: name };
  });
  ipcMain.handle("workspace:diff", async (_event, relativePath: string) => {
    const state = store.snapshot();
    const workspacePath = requireWorkspace(state.workspacePath ?? "", state);
    try {
      const { response } = runtime.request("workspace.diff", {
        path: workspacePath,
        relativePath,
      });
      const result = await response;
      return typeof result.patch === "string" ? result.patch : "";
    } catch {
      return "";
    }
  });
  ipcMain.handle("workspace:stage", async (_event, paths: string[]) => {
    const state = store.snapshot();
    const workspacePath = requireWorkspace(state.workspacePath ?? "", state);
    await runtime.request("workspace.stage", { path: workspacePath, paths })
      .response;
  });
  ipcMain.handle("workspace:unstage", async (_event, paths: string[]) => {
    const state = store.snapshot();
    const workspacePath = requireWorkspace(state.workspacePath ?? "", state);
    await runtime.request("workspace.unstage", { path: workspacePath, paths })
      .response;
  });
  ipcMain.handle("workspace:commit", async (_event, message: string) => {
    const state = store.snapshot();
    const workspacePath = requireWorkspace(state.workspacePath ?? "", state);
    await runtime.request("workspace.commit", { path: workspacePath, message })
      .response;
  });
  ipcMain.handle("workspace:sync", async () => {
    const state = store.snapshot();
    const workspacePath = requireWorkspace(state.workspacePath ?? "", state);
    const { response } = runtime.request("workspace.sync", {
      path: workspacePath,
    });
    return (await response).sync;
  });
  ipcMain.handle("workspace:fetch", async () => {
    const state = store.snapshot();
    const workspacePath = requireWorkspace(state.workspacePath ?? "", state);
    const { response } = runtime.request("workspace.fetch", {
      path: workspacePath,
    });
    return (await response).sync;
  });
  ipcMain.handle("workspace:pull", async () => {
    const state = store.snapshot();
    const workspacePath = requireWorkspace(state.workspacePath ?? "", state);
    const { response } = runtime.request("workspace.pull", {
      path: workspacePath,
    });
    return (await response).sync;
  });
  ipcMain.handle("workspace:push", async () => {
    const state = store.snapshot();
    const workspacePath = requireWorkspace(state.workspacePath ?? "", state);
    const { response } = runtime.request("workspace.push", {
      path: workspacePath,
    });
    return (await response).sync;
  });
  ipcMain.handle("workspace:tags", async () => {
    const state = store.snapshot();
    const workspacePath = requireWorkspace(state.workspacePath ?? "", state);
    const { response } = runtime.request("workspace.tags", {
      path: workspacePath,
    });
    const result = await response;
    return Array.isArray(result.tags) ? result.tags : [];
  });
  ipcMain.handle("workspace:create-tag", async (_event, name: string) => {
    const state = store.snapshot();
    const workspacePath = requireWorkspace(state.workspacePath ?? "", state);
    await runtime.request("workspace.createTag", { path: workspacePath, name })
      .response;
  });
  ipcMain.handle(
    "workspace:revert-commit",
    async (_event, revision: string) => {
      const state = store.snapshot();
      const workspacePath = requireWorkspace(state.workspacePath ?? "", state);
      await runtime.request("workspace.revertCommit", {
        path: workspacePath,
        revision,
      }).response;
    },
  );
  ipcMain.handle("workspace:stash", async (_event, message?: string) => {
    const state = store.snapshot();
    const workspacePath = requireWorkspace(state.workspacePath ?? "", state);
    await runtime.request("workspace.stash", { path: workspacePath, message })
      .response;
  });
  ipcMain.handle("workspace:apply-stash", async () => {
    const state = store.snapshot();
    const workspacePath = requireWorkspace(state.workspacePath ?? "", state);
    await runtime.request("workspace.applyStash", { path: workspacePath })
      .response;
  });
  ipcMain.handle("workspace:discard", async (_event, relativePath: string) => {
    const state = store.snapshot();
    const workspacePath = requireWorkspace(state.workspacePath ?? "", state);
    await runtime.request("workspace.discard", {
      path: workspacePath,
      relativePath,
    }).response;
  });
  ipcMain.handle(
    "checkpoint:restore",
    async (_event, checkpointId: string, paths?: string[]) => {
      const state = store.snapshot();
      const workspacePath = requireWorkspace(state.workspacePath ?? "", state);
      const result = await runtime.request("checkpoint.restore", {
        path: workspacePath,
        checkpointId,
        paths: Array.isArray(paths) ? paths : undefined,
      }).response;
      return Array.isArray(result.files) ? (result.files as string[]) : [];
    },
  );
  ipcMain.handle(
    "checkpoint:restore-latest-mutation",
    async (_event, checkpointId: string, relativePath: string) => {
      const state = store.snapshot();
      const workspacePath = requireWorkspace(state.workspacePath ?? "", state);
      await runtime.request("checkpoint.restoreLatestMutation", {
        path: workspacePath,
        checkpointId,
        relativePath,
      }).response;
    },
  );
  ipcMain.handle("context:preview", async () => {
    const state = store.snapshot();
    const workspacePath = requireWorkspace(state.workspacePath ?? "", state);
    return runtime.request("context.preview", { path: workspacePath }).response;
  });
  ipcMain.handle("memory:list", async () => {
    const state = store.snapshot();
    if (!state.workspacePath) return [];
    try {
      const { response } = runtime.request("memory.list", {
        path: state.workspacePath,
      });
      const result = await response;
      return Array.isArray(result.memories) ? result.memories : [];
    } catch {
      return [];
    }
  });
  ipcMain.handle("memory:delete", async (_event, id: string) => {
    const state = store.snapshot();
    const workspacePath = requireWorkspace(state.workspacePath ?? "", state);
    await runtime.request("memory.delete", { path: workspacePath, id })
      .response;
  });
  ipcMain.handle("memory:clear", async () => {
    const state = store.snapshot();
    const workspacePath = requireWorkspace(state.workspacePath ?? "", state);
    await runtime.request("memory.clear", { path: workspacePath }).response;
  });
  ipcMain.handle("terminal:spawn", (_event, cols: number, rows: number) => {
    const state = store.snapshot();
    const workspacePath = requireWorkspace(state.workspacePath ?? "", state);
    return terminals.spawn(workspacePath, cols, rows, state.terminalShell);
  });
  ipcMain.on("terminal:input", (_event, data: string) => {
    const state = store.snapshot();
    if (state.workspacePath) terminals.write(state.workspacePath, data);
  });
  ipcMain.on("terminal:resize", (_event, cols: number, rows: number) => {
    const state = store.snapshot();
    if (state.workspacePath) terminals.resize(state.workspacePath, cols, rows);
  });
  ipcMain.handle("terminal:kill", () => {
    const state = store.snapshot();
    if (state.workspacePath) terminals.kill(state.workspacePath);
  });
  ipcMain.handle("runtime:health", async () => {
    const { response } = runtime.request("health");
    return response;
  });
  ipcMain.handle("runtime:models", async (_event, providerId: string) => {
    const provider = profileById(store.snapshot(), providerId);
    const { response } = runtime.request("models.list", {
      providerId,
      providerKind: provider.kind,
      auth: provider.authentication,
    });
    return (await response).models as ModelInfo[];
  });
  ipcMain.handle(
    "runtime:provider:verify",
    async (_event, providerId: string, kind: string, auth: string) => {
      const { response } = runtime.request("models.list", {
        providerId,
        providerKind: kind,
        auth,
      });
      return (await response).models as ModelInfo[];
    },
  );
  ipcMain.handle(
    "runtime:credential:set",
    async (_event, providerId: string, value: string) => {
      const { response } = runtime.request("credentials.set", {
        providerId,
        value,
      });
      return response;
    },
  );
  ipcMain.handle(
    "runtime:credential:delete",
    async (_event, providerId: string) => {
      const { response } = runtime.request("credentials.delete", {
        providerId,
      });
      return response;
    },
  );
  ipcMain.handle("runtime:mcp:inspect", async (_event, server: unknown) => {
    const result = await runtime.request("mcp.inspect", { server }).response;
    return Array.isArray(result.tools) ? result.tools : [];
  });
  // Compaction is a single summarizer round-trip, not a run: it streams no
  // events and resolves with the folded history, so it is awaited here rather
  // than tracked in the renderer's active-run registry.
  ipcMain.handle(
    "runtime:compact",
    async (_event, params: CompactAgentParams) => {
      const state = store.snapshot();
      const workspacePath = requireWorkspace(params.workspacePath, state);
      const provider = profileById(state, params.providerId);
      if (!params.model) throw new Error("No model selected.");
      return runtime.request("agent.compact", {
        ...params,
        workspacePath,
        providerKind: provider.kind,
        auth: provider.authentication,
      }).response;
    },
  );
  ipcMain.handle(
    "runtime:agent",
    (_event, params: StartAgentParams): string => {
      const state = store.snapshot();
      const workspacePath = requireWorkspace(params.workspacePath, state);
      const provider = profileById(state, params.providerId);
      if (!params.model) throw new Error("No model selected.");
      // `request` returns synchronously, so the forwarder closes over the final
      // run id — no event can ever be sent with an empty or stale id.
      const started = runtime.request(
        "agent.run",
        {
          ...params,
          workspacePath,
          providerKind: provider.kind,
          auth: provider.authentication,
        },
        (event) =>
          mainWindow?.webContents.send("runtime:event", {
            runId: started.id,
            event,
          }),
      );
      started.response
        .then((result) =>
          mainWindow?.webContents.send("runtime:finished", {
            runId: started.id,
            result,
          }),
        )
        .catch((error: Error) =>
          mainWindow?.webContents.send("runtime:failed", {
            runId: started.id,
            message: error.message,
            cancelled: Boolean(
              (error as Error & { cancelled?: boolean }).cancelled,
            ),
          }),
        );
      return started.id;
    },
  );
  ipcMain.handle("runtime:cancel", (_event, runId: string) =>
    runtime.cancel(runId),
  );
  ipcMain.handle(
    "runtime:approve",
    async (_event, runId: string, callId: string, approved: boolean) => {
      const { response } = runtime.request("agent.approve", {
        runId,
        callId,
        approved,
      });
      return response;
    },
  );
  ipcMain.handle(
    "oauth:signin",
    async (_event, providerId: string, providerKind: string) => {
      const { response } = runtime.request(
        "oauth.signin",
        { providerId, providerKind },
        (event) => {
          if (event.type !== "authorize_url") return;
          const url = new URL(event.url);
          // ChatGPT authorizes on auth.openai.com; Kimi's device flow verifies
          // on www.kimi.com (the grant itself is against auth.kimi.com).
          const trusted = ["auth.openai.com", "www.kimi.com", "auth.kimi.com"];
          if (url.protocol === "https:" && trusted.includes(url.hostname))
            void shell.openExternal(url.toString());
        },
      );
      return response;
    },
  );
}

app.whenReady().then(async () => {
  const state = await store.load();
  if (!app.isPackaged && process.platform === "darwin")
    app.dock?.setIcon(DEV_ICON);
  installContentSecurityPolicy();
  registerIpc();
  createWindow(state);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0)
      createWindow(store.snapshot());
  });
});

app.on("window-all-closed", () => {
  terminals.killAll();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  terminals.killAll();
  runtime.dispose();
});
