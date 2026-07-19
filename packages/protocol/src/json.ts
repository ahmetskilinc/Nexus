/// Tolerant accessors over `unknown`, replacing the Rust runtime's
/// `serde_json::Value` indexing idioms (`value["a"]["b"].as_str()`). Provider
/// stream payloads and model-supplied tool arguments are deliberately NOT
/// schema-validated: unknown extra fields must be ignored and missing fields
/// must default, so a provider adding a field never breaks a run.

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/// `get(value, "a", 0, "b")` ≙ Rust's `value["a"][0]["b"]` — returns undefined
/// anywhere along a missing path instead of throwing.
export function get(value: unknown, ...path: (string | number)[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (typeof key === "number") {
      const array = asArray(current);
      current = array?.[key];
    } else {
      const record = asRecord(current);
      current = record?.[key];
    }
    if (current === undefined) return undefined;
  }
  return current;
}
