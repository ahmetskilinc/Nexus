import { type ReactNode, useEffect, useState } from "react";
import { BrandMark } from "./BrandMark";

/// How long the bare-glass splash holds before the app crossfades in.
const HOLD_MS = 1500;
/// Crossfade length (splash out / app in) after the hold.
const REVEAL_MS = 600;

/// Boot splash: for the first moment the window is nothing but the vibrancy
/// material and the brand mark — the app renders beneath at opacity 0 (so it
/// finishes loading during the hold) and crossfades in when the splash lifts.
/// Lives OUTSIDE <App/> so App's own loading branches can't remount it.
/// Under vibrancy the splash root is transparent (see .splash-shell in
/// styles.css); on platforms without the material it falls back to an opaque
/// background, and the icon animation still plays.
export function Boot({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<"hold" | "reveal" | "done">("hold");

  useEffect(() => {
    const reveal = setTimeout(() => setPhase("reveal"), HOLD_MS);
    const done = setTimeout(() => setPhase("done"), HOLD_MS + REVEAL_MS);
    return () => {
      clearTimeout(reveal);
      clearTimeout(done);
    };
  }, []);

  return (
    <>
      <div
        aria-hidden={phase === "hold" || undefined}
        className={`h-full transition-opacity duration-600 ease-out motion-reduce:transition-none ${
          phase === "hold" ? "opacity-0" : "opacity-100"
        }`}
      >
        {children}
      </div>
      {phase !== "done" ? (
        <div
          aria-hidden
          className={`splash-shell fixed inset-0 z-[100] grid place-items-center bg-background transition-opacity duration-600 ease-out motion-reduce:transition-none ${
            phase === "reveal" ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
        >
          <div className="animate-in fade-in zoom-in-75 slide-in-from-bottom-2 fill-mode-both duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:animate-none">
            <BrandMark
              size={84}
              className="drop-shadow-[0_18px_50px_rgba(255,122,89,0.35)]"
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
