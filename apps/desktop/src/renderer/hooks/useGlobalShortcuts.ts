import { useEffect, useRef } from "react";

export type Shortcuts = {
  newTask: () => void;
  openSettings: () => void;
  toggleLeft: () => void;
  toggleRight: () => void;
  quickOpen: () => void;
  workspaceSearch: () => void;
  closeOverlays: () => void;
};

/// Registers one window-level keyboard handler. The latest handler set lives in
/// a ref (rebuilt after every commit via `build`) so the listener is bound once
/// yet always calls current closures. `enabled` gates the rebuild so handlers
/// that read loaded app state never run before it exists.
export function useGlobalShortcuts(build: () => Shortcuts, enabled: boolean) {
  const ref = useRef<Shortcuts | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        ref.current?.closeOverlays();
        return;
      }
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const shortcuts = ref.current;
      if (!shortcuts) return;
      const key = event.key.toLowerCase();
      const run = (action: () => void) => {
        event.preventDefault();
        action();
      };
      if (key === "n") run(shortcuts.newTask);
      else if (key === ",") run(shortcuts.openSettings);
      else if (key === "b") run(shortcuts.toggleLeft);
      else if (key === "\\") run(shortcuts.toggleRight);
      else if (key === "p") run(shortcuts.quickOpen);
      else if (key === "f") run(shortcuts.workspaceSearch);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    ref.current = build();
  });
}
