/// Case-insensitive comparison with numeric runs compared by value, close to
/// Foundation's localizedStandardCompare so the sidebar ordering is stable.
///
/// Hand-rolled on purpose — Intl.Collator's numeric mode makes different
/// tie-break decisions (leading zeros, case) than the Rust/Swift original.
export function naturalCompare(a: string, b: string): number {
  /// Spread iterates Unicode code points, matching Rust's `chars()`.
  const left = [...a];
  const right = [...b];
  let i = 0;
  let j = 0;
  for (;;) {
    const l = left[i];
    const r = right[j];
    if (l === undefined && r === undefined) return 0;
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    if (isAsciiDigit(l) && isAsciiDigit(r)) {
      let lnum = "";
      while (i < left.length && isAsciiDigit(left[i])) {
        lnum += left[i];
        i += 1;
      }
      let rnum = "";
      while (j < right.length && isAsciiDigit(right[j])) {
        rnum += right[j];
        j += 1;
      }
      const ltrim = trimLeadingZeros(lnum);
      const rtrim = trimLeadingZeros(rnum);
      // Longer trimmed run is the larger number; equal-length runs compare
      // digit-by-digit; leading zeros are the final tiebreak.
      const ordering =
        compare(ltrim.length, rtrim.length) ||
        compareCodePoints(ltrim, rtrim) ||
        compareCodePoints(lnum, rnum);
      if (ordering !== 0) return ordering;
    } else {
      const ordering =
        compareCodePoints(l.toLowerCase(), r.toLowerCase()) ||
        compareCodePoints(l, r);
      if (ordering !== 0) return ordering;
      i += 1;
      j += 1;
    }
  }
}

function isAsciiDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

function trimLeadingZeros(digits: string): string {
  let start = 0;
  while (start < digits.length && digits[start] === "0") start += 1;
  return digits.slice(start);
}

function compare(a: number, b: number): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/// Lexicographic comparison by Unicode code point, matching Rust's `str::cmp`.
/// Plain `<` on JS strings compares UTF-16 code units, which misorders
/// astral-plane characters against U+E000..U+FFFF.
function compareCodePoints(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const ordering = compare(
      left[index].codePointAt(0) ?? 0,
      right[index].codePointAt(0) ?? 0,
    );
    if (ordering !== 0) return ordering;
  }
  return compare(left.length, right.length);
}
