import { asRecord, asString } from "./json";

/// A run-aborting runtime failure whose message is shown to the user.
///
/// Distinct from a *tool* failure, which is conversation content addressed to
/// the model (a plain "Error: …" sentence in the tool result) and must never
/// abort the run — tool failures stay plain strings, exactly like the Rust
/// `ToolError` type alias.
export class RuntimeError extends Error {
  readonly httpStatus?: number;

  constructor(message: string, options?: { httpStatus?: number }) {
    super(message);
    this.name = "RuntimeError";
    this.httpStatus = options?.httpStatus;
  }

  static msg(text: string): RuntimeError {
    return new RuntimeError(text);
  }

  static invalidResponse(): RuntimeError {
    return new RuntimeError("The provider returned an invalid response.");
  }

  static credentialMismatch(): RuntimeError {
    return new RuntimeError(
      "This provider profile has a credential of the wrong type. Remove and re-add it.",
    );
  }

  /// Build a failure from a non-2xx HTTP response body. Provider error bodies
  /// are JSON in a handful of shapes — `{"detail": "..."}` (ChatGPT backend),
  /// `{"error": {"message": "..."}}` (OpenAI/Anthropic APIs), `{"message":
  /// "..."}`, `{"error": "..."}` — so extract the human sentence instead of
  /// showing the user raw JSON. Falls back to the (truncated) body when no
  /// message can be found.
  static http(status: number, body: string): RuntimeError {
    const detail =
      extractErrorMessage(body) ??
      (body.trim().length === 0
        ? "The provider request failed."
        : [...body.trim()].slice(0, 300).join(""));
    return new RuntimeError(`${detail} (HTTP ${status})`, {
      httpStatus: status,
    });
  }
}

function extractErrorMessage(body: string): string | undefined {
  let value: unknown;
  try {
    value = JSON.parse(body.trim());
  } catch {
    return undefined;
  }
  const record = asRecord(value);
  if (!record) return undefined;
  const candidates = [
    asString(asRecord(record.error)?.message),
    asString(record.detail),
    asString(record.message),
    asString(record.error),
  ];
  for (const candidate of candidates) {
    const text = candidate?.trim();
    if (text) return text;
  }
  return undefined;
}
