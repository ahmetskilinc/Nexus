import { asRecord, asString, RuntimeError } from "@nexus/protocol";

/// Rust `string_param`: a required string parameter with the exact error
/// sentence the desktop shows.
export function stringParam(params: unknown, name: string): string {
  const value = asString(asRecord(params)?.[name]);
  if (value === undefined)
    throw RuntimeError.msg(`Missing required parameter "${name}".`);
  return value;
}

/// A required array-of-strings parameter (`paths`), matching the Rust
/// serde failure sentence.
export function stringArrayParam(params: unknown, name: string): string[] {
  const value = asRecord(params)?.[name];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    throw RuntimeError.msg(`The "${name}" parameter is malformed.`);
  return value;
}
