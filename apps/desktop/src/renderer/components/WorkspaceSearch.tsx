import { useEffect, useRef, useState } from "react";
import { FileIcon, SearchIcon } from "./Icons";

/// Literal full-text workspace search. Results are returned by the local runtime
/// and selecting one opens its safe file preview; no raw filesystem path enters
/// the renderer.
export function WorkspaceSearch({
  open,
  onOpenFile,
  onAttachSnippet,
  onClose,
}: {
  open: boolean;
  onOpenFile: (path: string) => void;
  onAttachSnippet: (result: {
    path: string;
    line: number;
    text: string;
  }) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    Array<{ path: string; line: number; text: string }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults([]);
    setActive(0);
    requestAnimationFrame(() => input.current?.focus());
  }, [open]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!open || !trimmed) {
      setResults([]);
      return;
    }
    let stale = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void window.nexus
        .searchWorkspace(trimmed)
        .then((next) => {
          if (!stale) setResults(next);
        })
        .catch(() => {
          if (!stale) setResults([]);
        })
        .finally(() => {
          if (!stale) setLoading(false);
        });
    }, 180);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  useEffect(() => {
    setActive((index) => Math.min(index, Math.max(0, results.length - 1)));
  }, [results.length]);

  if (!open) return null;
  function choose(path: string) {
    onOpenFile(path);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-start pt-[18vh]">
      <button
        type="button"
        aria-label="Close workspace search"
        onMouseDown={onClose}
        className="absolute inset-0 border-0 bg-black/25 backdrop-blur-[1px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search workspace"
        className="relative z-10 w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-popover shadow-[var(--shadow-pop)]"
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
                const result = results[active];
                if (result) choose(result.path);
              }
            }}
            placeholder="Search workspace text…"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-faint"
          />
          <span className="text-[10px] text-faint">⌘F</span>
        </div>
        <ul className="max-h-80 overflow-y-auto p-1.5">
          {results.map((result, index) => (
            <li key={`${result.path}:${result.line}`}>
              <button
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(result.path)}
                className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] transition ${
                  index === active
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <FileIcon size={13} className="mt-0.5 shrink-0 text-faint" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] text-foreground">
                    {result.path}:{result.line}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-faint">
                    {result.text || "(empty line)"}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onAttachSnippet(result);
                  onClose();
                }}
                className="rounded px-1.5 py-1 text-[10px] text-primary-soft transition hover:bg-secondary"
              >
                Attach
              </button>
            </li>
          ))}
          {query.trim() && !loading && results.length === 0 ? (
            <li className="px-2.5 py-6 text-center text-[12px] text-faint">
              No text matches
            </li>
          ) : null}
          {loading ? (
            <li className="px-2.5 py-4 text-center text-[12px] text-faint">
              Searching…
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
