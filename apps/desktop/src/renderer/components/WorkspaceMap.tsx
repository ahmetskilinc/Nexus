import { useEffect, useState } from "react";
import { CompassIcon } from "./Icons";

/// A local-only repository orientation card. It is intentionally a summary of
/// the safe index, not a semantic index or source-code upload.
export function WorkspaceMap() {
  const [map, setMap] = useState<{
    files: number;
    languages: Array<{ language: string; files: number }>;
    topLevel: string[];
  }>();

  useEffect(() => {
    let stale = false;
    void window.nexus
      .workspaceProjectMap()
      .then((next) => {
        if (!stale) setMap(next);
      })
      .catch(() => {
        if (!stale) setMap(undefined);
      });
    return () => {
      stale = true;
    };
  }, []);

  if (!map) return null;
  return (
    <section className="mx-auto mt-3 w-full max-w-[760px] rounded-xl border border-border-soft bg-card/40 px-3 py-2.5">
      <div className="flex items-center gap-2 text-[11px] font-semibold text-foreground">
        <CompassIcon size={13} className="text-primary-soft" />
        Workspace map
        <span className="font-mono font-normal text-faint">
          {map.files} files
        </span>
      </div>
      <p className="mt-1 truncate text-[11px] text-muted-foreground">
        {map.topLevel.join(" · ") || "No visible top-level entries"}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-faint">
        {map.languages.slice(0, 5).map((item) => (
          <span key={item.language}>
            {item.language} {item.files}
          </span>
        ))}
      </div>
    </section>
  );
}
