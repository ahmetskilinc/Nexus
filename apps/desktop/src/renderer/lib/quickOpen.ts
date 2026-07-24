/// Scores a case-insensitive subsequence match. Consecutive characters and
/// matches at path/component boundaries rank higher, so `cp ts` finds
/// `src/components/ChatPane.tsx` ahead of incidental substring matches.
export function quickOpenScore(
  path: string,
  query: string,
): number | undefined {
  const candidate = path.toLowerCase();
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  let total = 0;
  for (const term of terms) {
    let offset = 0;
    let previous = -2;
    for (const char of term) {
      const index = candidate.indexOf(char, offset);
      if (index === -1) return undefined;
      total += 1;
      if (index === previous + 1) total += 3;
      if (index === 0 || "/._-".includes(candidate[index - 1] ?? ""))
        total += 4;
      previous = index;
      offset = index + 1;
    }
    // Earlier matches are usually more intentional; small penalty prevents a
    // long path suffix from beating a direct filename match.
    total -= offset / Math.max(1, candidate.length);
    // Prefer a filename that begins with the query over a longer path where
    // the same text happens to occur later in a component.
    const filename = candidate.slice(candidate.lastIndexOf("/") + 1);
    if (filename.startsWith(term)) total += 12;
    total -= filename.length / 100;
  }
  return total;
}

export function rankQuickOpen(
  paths: string[],
  query: string,
  limit: number,
): string[] {
  return paths
    .flatMap((path) => {
      const score = quickOpenScore(path, query);
      return score === undefined ? [] : [{ path, score }];
    })
    .toSorted(
      (left, right) =>
        right.score - left.score || left.path.localeCompare(right.path),
    )
    .slice(0, limit)
    .map(({ path }) => path);
}
