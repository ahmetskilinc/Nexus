import type { Session } from "@nexus/protocol";
import { formatTokens } from "../lib/format";
import { Hint } from "./Tooltip";

/// The fraction of the context window at which the runtime compacts on its
/// own. Mirrors TRIGGER_FRACTION in @nexus/agent's compaction.ts — duplicated
/// rather than imported because that package is node-only (fs, MCP) and must
/// not enter the renderer bundle.
const TRIGGER_FRACTION = 0.7;

const RADIUS = 5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/// How full the model's context window is, as a ring plus a percentage.
/// Clicking it compacts the conversation now instead of waiting for the
/// automatic threshold. Renders nothing until a run has reported a reading —
/// there is no honest number to show before the first turn.
export function ContextMeter({
  session,
  onCompact,
  compacting,
  disabled,
}: {
  session?: Session;
  onCompact: () => void;
  /// A compaction round-trip is in flight; the ring pulses and the button is
  /// inert until it resolves.
  compacting: boolean;
  /// A run is in flight — compacting now would race it.
  disabled: boolean;
}) {
  const context = session?.context;
  if (!context || context.contextTokens <= 0) return null;

  const fraction = Math.min(context.usedTokens / context.contextTokens, 1);
  const percent = Math.round(fraction * 100);
  const hot = fraction >= TRIGGER_FRACTION;
  const label = (
    <span className="flex flex-col gap-0.5">
      <span>
        {context.usedTokens.toLocaleString()} /{" "}
        {context.contextTokens.toLocaleString()} tokens
        {context.estimated ? " (estimated)" : ""}
      </span>
      <span className="text-muted-foreground">
        {compacting
          ? "Compacting…"
          : disabled
            ? `Compacts automatically at ${Math.round(TRIGGER_FRACTION * 100)}%`
            : `Click to compact · automatic at ${Math.round(TRIGGER_FRACTION * 100)}%`}
      </span>
    </span>
  );

  return (
    <Hint side="bottom" label={label}>
      <button
        type="button"
        onClick={onCompact}
        disabled={disabled || compacting}
        aria-label={`Context ${percent}% full — compact conversation`}
        className={`app-no-drag flex items-center gap-1 rounded-md px-1 py-0.5 font-mono text-[11px] tabular-nums transition disabled:cursor-default ${
          hot ? "text-warning" : "text-faint"
        } enabled:hover:bg-accent enabled:hover:text-foreground ${
          compacting ? "animate-pulse" : ""
        }`}
      >
        <svg
          viewBox="0 0 14 14"
          className="size-3 -rotate-90"
          aria-hidden="true"
        >
          <circle
            cx="7"
            cy="7"
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            opacity="0.25"
          />
          <circle
            cx="7"
            cy="7"
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
          />
        </svg>
        <span>{percent}%</span>
      </button>
    </Hint>
  );
}

/// The compact-now action for the composer footer, where there is no room for
/// the ring. Shows the same percentage as a plain label.
export function CompactButton({
  session,
  onCompact,
  compacting,
  disabled,
}: {
  session?: Session;
  onCompact: () => void;
  compacting: boolean;
  disabled: boolean;
}) {
  const context = session?.context;
  const used = context ? formatTokens(context.usedTokens) : undefined;
  return (
    <Hint
      side="top"
      label={
        used
          ? `Summarize the older turns now (${used} in context)`
          : "Summarize the older turns now"
      }
    >
      <button
        type="button"
        onClick={onCompact}
        disabled={disabled || compacting}
        className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-faint transition enabled:hover:text-foreground disabled:opacity-50"
      >
        {compacting ? "Compacting…" : "Compact"}
      </button>
    </Hint>
  );
}
