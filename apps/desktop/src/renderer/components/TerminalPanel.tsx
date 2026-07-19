import { m } from "motion/react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { CloseIcon, TerminalIcon } from "./Icons";
import { Hint } from "./Tooltip";

/// xterm palettes for the two app themes.
///
/// The background stays fully transparent so the panel surface shows through
/// (xterm's own stylesheet also hardcodes a black viewport — overridden in
/// styles.css). The 16 ANSI slots are drawn from the same tokens the rest of the
/// app uses rather than xterm's defaults, so shell output, prompt segments, and
/// tool cards read as one palette: destructive → red, positive → green, warning →
/// yellow, and the category colours (explore/build) → blue/magenta.
///
/// Kept as literals rather than read from CSS custom properties: xterm parses
/// these once into its own colour manager and cannot resolve `var()`.
const THEMES = {
  dark: {
    background: "#00000000",
    foreground: "#ededed",
    cursor: "#ff7a59",
    cursorAccent: "#1e1e1e",
    selectionBackground: "#ff7a5940",
    selectionInactiveBackground: "#ffffff1f",
    black: "#2f2f2f",
    red: "#f2777a",
    green: "#6fcf97",
    yellow: "#e0b46b",
    blue: "#7aa2f7",
    magenta: "#b48ef2",
    cyan: "#6fcfd7",
    white: "#d6d6d6",
    brightBlack: "#6b6b6b",
    brightRed: "#ff9296",
    brightGreen: "#8fe0b4",
    brightYellow: "#f0cd8c",
    brightBlue: "#9dbcff",
    brightMagenta: "#cbaaf8",
    brightCyan: "#92e4e0",
    brightWhite: "#ffffff",
  },
  light: {
    background: "#00000000",
    foreground: "#1a1a1a",
    cursor: "#e35a38",
    cursorAccent: "#ffffff",
    selectionBackground: "#e35a3833",
    selectionInactiveBackground: "#0000001a",
    black: "#2b2b2b",
    red: "#d64550",
    green: "#1f9d57",
    yellow: "#b7791f",
    blue: "#3b6fe0",
    magenta: "#7c5cd6",
    cyan: "#0f8f97",
    white: "#c9c9cb",
    brightBlack: "#8a8a8a",
    brightRed: "#b8303b",
    brightGreen: "#177f45",
    brightYellow: "#96610f",
    brightBlue: "#2b57bd",
    brightMagenta: "#6544b8",
    brightCyan: "#0b7178",
    brightWhite: "#5c5c5e",
  },
} as const;

/// A live shell docked in the right column: xterm.js in the renderer, wired to a
/// node-pty process spawned in the main process (cwd = the active workspace).
/// One terminal per workspace, killed when the panel unmounts. Requires a
/// workspace, so the caller only mounts it with one selected.
export function TerminalPanel({
  resolvedTheme,
  workspacePath,
  onClose,
  onResizeStart,
  onResizeKeyDown,
}: {
  resolvedTheme: "light" | "dark";
  /// Re-mount the panel and attach to the workspace's persistent shell when the
  /// workspace changes.
  workspacePath: string;
  onClose: () => void;
  onResizeStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onResizeKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();

  // The whole lifecycle keys on workspacePath: a switch detaches this xterm view
  // and attaches to the shell for the new cwd. Hiding the panel keeps the PTY.
  //
  // xterm is dynamically imported here rather than at module scope so its
  // ~500 kB (plus its stylesheet) stays out of the renderer entry chunk and
  // loads only when the terminal panel is first opened.
  useEffect(() => {
    let disposed = false;
    let teardown: (() => void) | undefined;
    setError(undefined);

    void Promise.all([
      import("@xterm/xterm"),
      import("@xterm/addon-fit"),
      import("@xterm/xterm/css/xterm.css"),
    ]).then(([{ Terminal }, { FitAddon }]) => {
      const host = hostRef.current;
      if (disposed || !host) return;

      const term = new Terminal({
        fontSize: 13,
        // Fira Code rather than the app's Geist Mono: it is a true fixed-advance
        // face built for terminals, so xterm's single-cell-width grid lines up, and
        // it ships the `calt` ligatures (-> => != >=) enabled in styles.css.
        // "Symbols Nerd Font Mono" sits directly after it so shell prompts
        // (powerline separators, git/devicon glyphs) resolve instead of rendering
        // as tofu; it carries only private-use codepoints, so it never takes over
        // ordinary text. Both are bundled — see styles.css.
        fontFamily:
          "'Fira Code', 'Symbols Nerd Font Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
        theme: THEMES[resolvedTheme],
        cursorBlink: true,
        allowTransparency: true,
        // Must stay 1.0. Anything larger looks tidier for prose but breaks block
        // graphics: half-block characters (▀▄█) assume two rows compose one square
        // module, so a taller cell stretches QR codes, progress bars, and box
        // drawing vertically and opens gaps between contiguous rows.
        lineHeight: 1.0,
        // Names the two Fira Code faces actually loaded, so nothing is
        // synthetically bolded.
        fontWeight: 400,
        fontWeightBold: 600,
        // The default 1000 lines is easy to overrun with a build log.
        scrollback: 5000,
        // A hollow cursor when the panel loses focus, so it stops competing with
        // the composer caret for attention.
        cursorInactiveStyle: "outline",
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host);
      fit.fit();

      // Fira Code is a webfont served with `font-display: swap`, so the first
      // measurement can land on the fallback face and bake in the wrong cell width
      // — every column then drifts. Re-measure once the real face is in, which is
      // usually already true (resolved promise) and costs a microtask.
      void document.fonts.ready.then(() => {
        if (disposed) return;
        term.clearTextureAtlas?.();
        fit.fit();
      });

      const offData = window.nexus.onTerminalData(
        ({ workspacePath: from, data }) => {
          if (from === workspacePath) term.write(data);
        },
      );
      const offExit = window.nexus.onTerminalExit(({ workspacePath: from }) => {
        if (from === workspacePath && !disposed)
          term.write("\r\n\x1b[2m[process exited]\x1b[0m\r\n");
      });
      term.onData((data) => window.nexus.writeTerminal(data));

      void window.nexus
        .spawnTerminal(term.cols, term.rows)
        .then((result) => {
          if (disposed) return;
          if (!result.ok)
            setError(result.error ?? "Could not open a terminal.");
          else term.focus();
        })
        .catch(() => {
          if (!disposed) setError("Could not open a terminal.");
        });

      const observer = new ResizeObserver(() => {
        try {
          fit.fit();
          window.nexus.resizeTerminal(term.cols, term.rows);
        } catch {
          // Fit can throw before the element is laid out; ignore.
        }
      });
      observer.observe(host);

      teardown = () => {
        observer.disconnect();
        offData();
        offExit();
        term.dispose();
      };
    });

    return () => {
      disposed = true;
      teardown?.();
    };
  }, [workspacePath, resolvedTheme]);

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

      <div className="app-drag flex h-11 shrink-0 items-center gap-2 border-b border-border-soft px-3 pr-[var(--corner-controls,0px)]">
        <span className="grid size-5 shrink-0 place-items-center rounded-md bg-primary/10 text-primary-soft">
          <TerminalIcon size={13} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
          Terminal
        </span>
        <Hint label="Close panel" side="left">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="app-no-drag grid size-6 shrink-0 place-items-center rounded text-faint transition hover:bg-accent hover:text-foreground"
          >
            <CloseIcon size={14} />
          </button>
        </Hint>
      </div>

      {error ? (
        <div className="grid flex-1 place-items-center px-6 text-center text-[12px] text-faint">
          {error}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden p-2">
          {/* A recessed surface, matching the tool/code cards elsewhere, so the
              shell reads as content inside the panel rather than a hole in it.
              The fill is per-theme because `muted` and `panel` are the same value
              in dark — `background` is the one a step below `panel` there, while
              in light `muted` is what sits below white. */}
          <div className="nexus-terminal h-full w-full overflow-hidden rounded-lg border border-border-soft bg-muted px-2 py-1.5 dark:bg-background">
            <div ref={hostRef} className="h-full w-full" />
          </div>
        </div>
      )}
    </m.aside>
  );
}
