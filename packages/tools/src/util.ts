/// Small helpers shared across the tool modules. All output caps count
/// Unicode code points (the Rust runtime used `chars().take(n)`), never
/// UTF-16 code units.

/// Cap applied to model-facing tool output across every tool category.
export const OUTPUT_LIMIT = 20_000;

export function countCodePoints(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

export function takeCodePoints(text: string, limit: number): string {
  let out = "";
  let count = 0;
  for (const ch of text) {
    if (count >= limit) break;
    out += ch;
    count += 1;
  }
  return out;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/// Minimal percent-decoding (enough for `%xx` and `+`-as-space). Invalid
/// escapes are left as-is. Operates on UTF-8 bytes like the Rust original.
export function percentDecode(input: string): string {
  const bytes = Buffer.from(input, "utf8");
  const out: number[] = [];
  let index = 0;
  while (index < bytes.length) {
    const byte = bytes[index];
    if (byte === 0x25 && index + 2 < bytes.length) {
      const hex = bytes.subarray(index + 1, index + 3).toString("latin1");
      const decoded = /^[0-9a-fA-F]{2}$/.test(hex)
        ? Number.parseInt(hex, 16)
        : undefined;
      if (decoded !== undefined) {
        out.push(decoded);
        index += 3;
      } else {
        out.push(byte);
        index += 1;
      }
    } else if (byte === 0x2b) {
      out.push(0x20);
      index += 1;
    } else {
      out.push(byte);
      index += 1;
    }
  }
  return Buffer.from(out).toString("utf8");
}

/// Heuristic binary sniff: a NUL byte in the first 8 KiB. Used by the file
/// tools to refuse reading or editing binary files.
export function looksBinary(data: Uint8Array): boolean {
  const window = Math.min(data.length, 8192);
  for (let index = 0; index < window; index += 1) {
    if (data[index] === 0) return true;
  }
  return false;
}
