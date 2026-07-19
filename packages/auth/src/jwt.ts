/// Unverified JWT payload decode. We only read claims from tokens we just
/// received over TLS from the issuer, so no signature check is needed — this
/// mirrors the Rust runtime's `jwt_claims`, which returns an empty object for
/// anything malformed (missing payload segment, invalid base64url, bad JSON,
/// or a payload that is not a JSON object).
export function decodeJwtClaims(jwt: string): Record<string, unknown> {
  const payload = jwt.split(".")[1];
  if (payload === undefined) return {};
  /// Buffer's base64url decoder is lenient; reject non-base64url characters
  /// explicitly so garbage fails the same way Rust's strict decoder does.
  if (!/^[A-Za-z0-9_-]*$/.test(payload)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return {};
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}
