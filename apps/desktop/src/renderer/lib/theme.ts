import type { ThemePreference } from "@nexus/protocol";
import { useEffect, useState } from "react";

export type ResolvedTheme = "light" | "dark";

const QUERY = "(prefers-color-scheme: dark)";

function systemTheme(): ResolvedTheme {
  return window.matchMedia(QUERY).matches ? "dark" : "light";
}

export function useAppliedTheme(preference: ThemePreference): ResolvedTheme {
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    preference === "system" ? systemTheme() : preference,
  );

  useEffect(() => {
    if (preference !== "system") {
      setResolved(preference);
      return;
    }
    const media = window.matchMedia(QUERY);
    const update = () => setResolved(media.matches ? "dark" : "light");
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [preference]);

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  return resolved;
}
