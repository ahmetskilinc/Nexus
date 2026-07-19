import type { BrowserWindow } from "electron";
import type { IPty, spawn as PtySpawn } from "node-pty";
import {
  defaultShellArgs,
  loginShellEnvironment,
  resolveShell,
} from "./environment";

/// One shell process per workspace, bridged to the renderer's xterm.js view.
/// The native `node-pty` module is loaded lazily on first spawn — so unit tests
/// and terminal-less sessions never touch it, and a missing or ABI-mismatched
/// native build degrades to a clear error rather than crashing the app.
type PtyModule = { spawn: typeof PtySpawn };

let ptyModule: PtyModule | null | undefined;

function loadPty(): PtyModule | null {
  if (ptyModule === undefined) {
    try {
      // Lazy native require; keep it out of the module's import graph.
      ptyModule = require("node-pty") as PtyModule;
    } catch (error) {
      console.error("node-pty unavailable:", error);
      ptyModule = null;
    }
  }
  return ptyModule;
}

type TerminalSession = { proc: IPty; buffer: string };

export class TerminalManager {
  private sessions = new Map<string, TerminalSession>();

  constructor(private getWindow: () => BrowserWindow | undefined) {}

  /// Attaches to the workspace shell, spawning it only when one is not already
  /// alive. Keeping the PTY while the panel is hidden preserves shell state.
  spawn(
    workspacePath: string,
    cols: number,
    rows: number,
    preferredShell?: string,
  ): { ok: boolean; error?: string } {
    const existing = this.sessions.get(workspacePath);
    if (existing) {
      this.resize(workspacePath, cols, rows);
      if (existing.buffer)
        this.getWindow()?.webContents.send("terminal:data", {
          workspacePath,
          data: existing.buffer,
        });
      return { ok: true };
    }
    const pty = loadPty();
    if (!pty) {
      return {
        ok: false,
        error:
          "The terminal backend (node-pty) isn't available in this build. Rebuild native modules for Electron to enable it.",
      };
    }
    try {
      const shell = resolveShell(preferredShell);
      const args = defaultShellArgs(shell);
      // Names-only diagnostic: which shell/mode the PTY got, never env values.
      console.info(
        `Terminal PTY: spawning ${shell} ${args.join(" ") || "(no args)"} in ${workspacePath}.`,
      );
      const proc = pty.spawn(shell, args, {
        name: "xterm-color",
        cols: cols > 0 ? cols : 80,
        rows: rows > 0 ? rows : 24,
        cwd: workspacePath,
        env: loginShellEnvironment(),
      });
      const session: TerminalSession = { proc, buffer: "" };
      proc.onData((data: string) => {
        // Preserve enough scrollback to reconstruct xterm after the panel hides.
        session.buffer = `${session.buffer}${data}`.slice(-250_000);
        this.getWindow()?.webContents.send("terminal:data", {
          workspacePath,
          data,
        });
      });
      proc.onExit(() => {
        this.sessions.delete(workspacePath);
        this.getWindow()?.webContents.send("terminal:exit", { workspacePath });
      });
      this.sessions.set(workspacePath, session);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error ? error.message : "Could not open a shell.",
      };
    }
  }

  write(workspacePath: string, data: string) {
    this.sessions.get(workspacePath)?.proc.write(data);
  }

  resize(workspacePath: string, cols: number, rows: number) {
    if (cols <= 0 || rows <= 0) return;
    try {
      this.sessions.get(workspacePath)?.proc.resize(cols, rows);
    } catch {
      // A resize can race the process exiting; ignore.
    }
  }

  kill(workspacePath: string) {
    const session = this.sessions.get(workspacePath);
    if (!session) return;
    try {
      session.proc.kill();
    } catch {
      // Already gone.
    }
    this.sessions.delete(workspacePath);
  }

  killAll() {
    for (const session of this.sessions.values()) {
      try {
        session.proc.kill();
      } catch {
        // Already gone.
      }
    }
    this.sessions.clear();
  }
}
