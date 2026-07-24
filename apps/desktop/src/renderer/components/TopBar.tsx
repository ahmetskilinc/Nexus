import type { Session } from "@nexus/protocol";
import { formatTokens, formatUsd } from "../lib/format";
import { ContextMeter } from "./ContextMeter";
import { CloseIcon } from "./Icons";
import { Hint } from "./Tooltip";

/// The panel toggles + new-task action are pinned to the window corners in
/// app.tsx (they never move). This bar holds only the in-flow chrome — the
/// session title on the left, the session's token/cost meter on the right —
/// with padding that clears the fixed corner controls. `pb-1` centers the
/// content on the corner buttons' axis (top-[6px] + size-7 → center 20px).
///
/// In split view each pane renders its own bar: only the leftmost bar clears
/// the traffic-light corner (`padLeft`), only the rightmost clears the
/// right-panel toggle (`clearRight`), and the focused pane's title reads
/// brighter. `onClose` (split only) closes the pane.
export function TopBar({
  padLeft,
  clearRight,
  session,
  focused = true,
  onClose,
  onCompact = () => {},
  compacting = false,
  running = false,
}: {
  /// True when the fixed corner controls float over this bar's left edge —
  /// the leftmost bar while the sidebar is collapsed.
  padLeft: boolean;
  /// True when the right-panel toggle floats over this bar (panel closed), so
  /// the right edge must clear it.
  clearRight: boolean;
  session?: Session;
  focused?: boolean;
  onClose?: () => void;
  /// Compact this session's history now (the context meter is the button).
  /// Omitted by the sessionless bar over the Welcome screen, which has no
  /// meter to click.
  onCompact?: () => void;
  compacting?: boolean;
  running?: boolean;
}) {
  const inChat = Boolean(session && session.transcript.length > 0);
  const usage = session?.usage;

  return (
    <header className="app-drag relative z-10 flex h-11 shrink-0 items-center justify-between gap-2 px-2.5 pb-1">
      <div
        className={`flex min-w-0 items-center ${padLeft ? "pl-[150px]" : "pl-1"}`}
      >
        {inChat ? (
          <span
            className={`max-w-[300px] truncate text-[13px] font-medium ${
              focused ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            {session?.title}
          </span>
        ) : null}
      </div>
      <div
        className={`flex shrink-0 items-center gap-1.5 ${
          clearRight ? "pr-[var(--corner-controls,0px)]" : "pr-1"
        }`}
      >
        <ContextMeter
          session={session}
          onCompact={onCompact}
          compacting={compacting}
          disabled={running}
        />
        {usage ? (
          <Hint side="bottom" label="Session tokens in / out · estimated cost">
            <span className="app-no-drag flex items-center gap-2 font-mono text-[11px] text-faint tabular-nums">
              <span>↑{formatTokens(usage.inputTokens)}</span>
              <span>↓{formatTokens(usage.outputTokens)}</span>
              {session?.costUsd !== undefined ? (
                <span>{formatUsd(session.costUsd)}</span>
              ) : null}
            </span>
          </Hint>
        ) : null}
        {onClose ? (
          <Hint side="bottom" label="Close pane">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close pane"
              className="app-no-drag grid size-6 place-items-center rounded-md text-faint transition hover:bg-accent hover:text-foreground"
            >
              <CloseIcon size={13} />
            </button>
          </Hint>
        ) : null}
      </div>
    </header>
  );
}
