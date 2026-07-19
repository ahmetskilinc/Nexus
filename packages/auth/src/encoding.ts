import { createHash, randomBytes } from "node:crypto";

/// Percent-encodes every byte outside the RFC 3986 unreserved set, with
/// uppercase hex — byte-for-byte the Rust runtime's `percent_encode`, which the
/// OpenAI/Kimi endpoints have only ever been exercised against.
export function percentEncode(value: string): string {
  let encoded = "";
  for (const byte of Buffer.from(value, "utf8")) {
    if (
      (byte >= 0x41 && byte <= 0x5a) || // A-Z
      (byte >= 0x61 && byte <= 0x7a) || // a-z
      (byte >= 0x30 && byte <= 0x39) || // 0-9
      byte === 0x2d || // -
      byte === 0x2e || // .
      byte === 0x5f || // _
      byte === 0x7e // ~
    ) {
      encoded += String.fromCharCode(byte);
    } else {
      encoded += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return encoded;
}

/// Minimal percent-decoding (enough for `%xx` and `+`-as-space). Invalid
/// escapes are left as-is, matching the Rust runtime's `percent_decode` —
/// including its quirk that a `%xx` escape ending exactly at the end of the
/// string ("ab%4") is left literal.
export function percentDecode(input: string): string {
  const bytes = Buffer.from(input, "utf8");
  const out: number[] = [];
  let index = 0;
  while (index < bytes.length) {
    const byte = bytes[index] as number;
    if (byte === 0x25 /* % */ && index + 2 < bytes.length) {
      const hex = bytes.subarray(index + 1, index + 3).toString("latin1");
      if (/^[0-9a-fA-F]{2}$/.test(hex)) {
        out.push(Number.parseInt(hex, 16));
        index += 3;
      } else {
        out.push(byte);
        index += 1;
      }
    } else if (byte === 0x2b /* + */) {
      out.push(0x20);
      index += 1;
    } else {
      out.push(byte);
      index += 1;
    }
  }
  /// Buffer#toString("utf8") replaces invalid sequences with U+FFFD — the same
  /// lossy behavior as Rust's `String::from_utf8_lossy`.
  return Buffer.from(out).toString("utf8");
}

/// application/x-www-form-urlencoded body. Keys are written verbatim (they are
/// always plain ASCII identifiers); only values are encoded — as in the Rust.
export function formEncode(
  fields: readonly (readonly [string, string])[],
): string {
  return fields
    .map(([key, value]) => `${key}=${percentEncode(value)}`)
    .join("&");
}

/// Unpadded URL-safe base64 (Rust's `URL_SAFE_NO_PAD`).
export function base64Url(data: Uint8Array | string): string {
  return Buffer.from(data as Uint8Array).toString("base64url");
}

/// PKCE pair: verifier = base64url(64 random bytes), challenge =
/// base64url(SHA-256 of the verifier's ASCII bytes) — the S256 method.
export function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(64));
  const challenge = base64Url(
    createHash("sha256").update(verifier, "utf8").digest(),
  );
  return { verifier, challenge };
}

/// Opaque CSRF state for the authorize redirect: base64url(32 random bytes).
export function randomState(): string {
  return base64Url(randomBytes(32));
}
