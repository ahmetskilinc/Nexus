/// A minimal line-level diff for rendering edit previews in the approval card.
/// Not a full Myers implementation — an LCS backtrack that is more than adequate
/// for the modestly sized before/after previews the runtime sends.

export type DiffRow =
  | { type: "add" | "del" | "context"; text: string }
  | { type: "fold"; count: number };

// Above this line count the quadratic LCS table gets expensive; fall back to a
// plain delete-all / add-all rather than risk janking the UI.
const LCS_CAP = 2000;

export function diffLines(before: string, after: string): DiffRow[] {
  const a = before.length ? before.split("\n") : [];
  const b = after.length ? after.split("\n") : [];

  if (a.length > LCS_CAP || b.length > LCS_CAP) {
    return [
      ...a.map((text) => ({ type: "del" as const, text })),
      ...b.map((text) => ({ type: "add" as const, text })),
    ];
  }

  const m = a.length;
  const n = b.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      rows.push({ type: "context", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      rows.push({ type: "del", text: a[i] });
      i++;
    } else {
      rows.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < m) rows.push({ type: "del", text: a[i++] });
  while (j < n) rows.push({ type: "add", text: b[j++] });
  return rows;
}

/// Collapses long unchanged runs into a single `fold` marker, keeping `pad`
/// lines of context around each change so the diff reads like a patch hunk.
export function foldContext(rows: DiffRow[], pad = 3): DiffRow[] {
  const out: DiffRow[] = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i].type !== "context") {
      out.push(rows[i]);
      i++;
      continue;
    }
    let j = i;
    while (j < rows.length && rows[j].type === "context") j++;
    const runLength = j - i;
    const head = i === 0 ? 0 : pad;
    const tail = j === rows.length ? 0 : pad;
    if (runLength <= head + tail + 1) {
      for (let k = i; k < j; k++) out.push(rows[k]);
    } else {
      for (let k = i; k < i + head; k++) out.push(rows[k]);
      out.push({ type: "fold", count: runLength - head - tail });
      for (let k = j - tail; k < j; k++) out.push(rows[k]);
    }
    i = j;
  }
  return out;
}
