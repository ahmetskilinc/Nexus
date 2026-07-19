import { asRecord } from "@nexus/protocol";

/// The compact `key: value, …` argument summary shown next to a tool call in
/// the transcript. Keys sort alphabetically; the whole line caps at 140 code
/// points. Non-object or empty arguments render as an empty string.
export function summarizeArgs(argumentsJson: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsJson);
  } catch {
    return "";
  }
  const record = asRecord(parsed);
  if (!record) return "";
  const keys = Object.keys(record).sort();
  if (keys.length === 0) return "";
  const summary = keys
    .map((key) => {
      const value = record[key];
      return `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`;
    })
    .join(", ");
  return [...summary].slice(0, 140).join("");
}
