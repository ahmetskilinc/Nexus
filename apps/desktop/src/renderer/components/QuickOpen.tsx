import { useEffect, useMemo, useRef, useState } from "react";
import { rankQuickOpen } from "../lib/quickOpen";
import { FileIcon, SearchIcon } from "./Icons";

const MAX_RESULTS = 10;

/// Keyboard-first workspace file picker. It intentionally operates on the
/// existing safe workspace index: no filesystem paths are accepted from the UI.
export function QuickOpen({
  open,
  files,
  onOpenFile,
  onClose,
}: {
  open: boolean;
  files: string[];
  onOpenFile: (path: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => {
    return rankQuickOpen(files, query, MAX_RESULTS);
  }, [files, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    requestAnimationFrame(() => input.current?.focus());
  }, [open]);
  useEffect(() => {
    setActive((index) => Math.min(index, Math.max(0, results.length - 1)));
  }, [results.length]);

  if (!open) return null;
  function choose(path: string | undefined) {
    if (!path) return;
    onOpenFile(path);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-start pt-[18vh]">
      <button
        type="button"
        aria-label="Close quick open"
        onMouseDown={onClose}
        className="absolute inset-0 border-0 bg-black/25 backdrop-blur-[1px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Quick open file"
        className="relative z-10 w-full max-w-xl overflow-hidden rounded-xl border border-border bg-popover shadow-[var(--shadow-pop)]"
      >
        <div className="flex items-center gap-2 border-b border-border-soft px-3 py-2.5">
          <SearchIcon size={16} className="text-faint" />
          <input
            ref={input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              else if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((index) => (index + 1) % Math.max(1, results.length));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive(
                  (index) =>
                    (index - 1 + Math.max(1, results.length)) %
                    Math.max(1, results.length),
                );
              } else if (event.key === "Enter") {
                event.preventDefault();
                choose(results[active]);
              }
            }}
            placeholder="Search files by name or path…"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-faint"
          />
          <span className="text-[10px] text-faint">⌘P</span>
        </div>
        <ul className="max-h-80 overflow-y-auto p-1.5">
          {results.map((path, index) => (
            <li key={path}>
              <button
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(path)}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] transition ${
                  index === active
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground"
                }`}
              >
                <FileIcon size={13} className="shrink-0 text-faint" />
                <span className="truncate">{path}</span>
              </button>
            </li>
          ))}
          {results.length === 0 ? (
            <li className="px-2.5 py-6 text-center text-[12px] text-faint">
              No matching files
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
