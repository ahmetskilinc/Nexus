import { useEffect, useState } from "react";

/// Subscribes to a CSS media query and re-renders on match changes. Used to
/// switch the left sidebar between an inline docked column (wide) and an
/// overlay Drawer (narrow).
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
