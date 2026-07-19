import { basename } from "../lib/format";

/// Autocomplete dropdown for @-mentions in the composer. Anchored above the
/// input; the parent owns the filtered `items` and the highlighted index.
/// Mouse-down (not click) drives selection so the textarea keeps focus and its
/// caret through the pick.
export function MentionMenu({
  items,
  activeIndex,
  onSelect,
  onHover,
}: {
  items: string[];
  activeIndex: number;
  onSelect: (path: string) => void;
  onHover: (index: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <ul className="absolute bottom-full left-2 z-50 mb-2 max-h-56 w-[min(360px,90%)] overflow-auto rounded-lg border border-border bg-popover py-1 shadow-[var(--shadow-pop)]">
      {items.map((path, index) => {
        const name = basename(path);
        const dir = path.slice(0, path.length - name.length).replace(/\/$/, "");
        return (
          <li key={path}>
            <button
              type="button"
              // Keep textarea focus/caret: mousedown fires before blur.
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(path);
              }}
              onMouseEnter={() => onHover(index)}
              className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-[12px] outline-none ${
                index === activeIndex
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              <span className="shrink-0 font-medium text-foreground">
                {name}
              </span>
              {dir ? (
                <span className="truncate text-[11px] text-faint">{dir}</span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
