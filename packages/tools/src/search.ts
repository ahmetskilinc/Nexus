/// grep and glob over the workspace index, plus the hand-rolled glob→regex
/// translation, ported from the Rust runtime's readonly.rs.

import * as fs from "node:fs";
import { asString, ToolError } from "@nexus/protocol";
import { resolvePath } from "./path";
import { errorMessage, looksBinary, takeCodePoints } from "./util";
import { indexWorkspace } from "./workspace-index";

const GREP_MATCH_LIMIT = 100;
const GLOB_MATCH_LIMIT = 200;

/// Rust's `char::is_alphanumeric()`: Alphabetic or a Unicode number.
const ALPHANUMERIC = /[\p{Alphabetic}\p{Nd}\p{Nl}\p{No}]/u;

/// Translates a glob pattern into an anchored regex. Supports `*` (any run
/// within a path segment), `**` (any run across segments), `?` (one non-slash
/// character), and character classes `[...]`; every other character is matched
/// literally.
export function globToRegex(pattern: string): RegExp {
  let regex = "^";
  const chars = [...pattern];
  let index = 0;
  while (index < chars.length) {
    const ch = chars[index];
    if (ch === "*") {
      if (chars[index + 1] === "*") {
        // `**/` consumes the slash so it can also match zero segments;
        // a bare `**` matches anything including slashes.
        index += 2;
        if (chars[index] === "/") {
          index += 1;
          regex += "(?:.*/)?";
        } else {
          regex += ".*";
        }
        continue;
      }
      regex += "[^/]*";
    } else if (ch === "?") {
      regex += "[^/]";
    } else if (ch === "[") {
      regex += "[";
      index += 1;
      if (chars[index] === "!") {
        regex += "^";
        index += 1;
      }
      while (index < chars.length && chars[index] !== "]") {
        const inner = chars[index];
        if ("\\^]".includes(inner)) regex += "\\";
        regex += inner;
        index += 1;
      }
      if (index >= chars.length) {
        throw new ToolError('unterminated "[" in glob pattern.');
      }
      regex += "]";
    } else {
      if (!ALPHANUMERIC.test(ch) && ch !== "/") regex += "\\";
      regex += ch;
    }
    index += 1;
  }
  regex += "$";
  try {
    // No "s" flag: the Rust regex crate's `.` also stops at newlines.
    return new RegExp(regex);
  } catch {
    throw new ToolError("invalid glob pattern.");
  }
}

export function globTool(
  workspace: string,
  args: Record<string, unknown>,
): string {
  const pattern = asString(args.pattern);
  if (pattern === undefined) throw new ToolError('"pattern" is required.');
  const scope = asString(args.path) ?? "";
  const regex = globToRegex(pattern);
  let files: string[];
  try {
    files = indexWorkspace(workspace);
  } catch (error) {
    throw new ToolError(errorMessage(error));
  }
  const prefix = scope === "" ? "" : scope.endsWith("/") ? scope : `${scope}/`;
  const matches = files
    .filter((file) => prefix === "" || file.startsWith(prefix))
    .filter((file) => {
      // Match against the path relative to the scope, so patterns like
      // "**/*.rs" behave the same with or without a scope.
      const candidate = file.startsWith(prefix)
        ? file.slice(prefix.length)
        : file;
      return regex.test(candidate) || regex.test(file);
    })
    .slice(0, GLOB_MATCH_LIMIT + 1);
  if (matches.length === 0) return "No matching files.";
  if (matches.length > GLOB_MATCH_LIMIT) {
    matches.length = GLOB_MATCH_LIMIT;
    matches.push(
      `[Stopped at ${GLOB_MATCH_LIMIT} matches — narrow the pattern]`,
    );
  }
  return matches.join("\n");
}

export function grepTool(
  workspace: string,
  args: Record<string, unknown>,
): string {
  const pattern = asString(args.pattern);
  if (pattern === undefined) throw new ToolError('"pattern" is required.');
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch {
    throw new ToolError("invalid regular expression.");
  }
  const scope = asString(args.path) ?? "";
  let allFiles: string[];
  try {
    allFiles = indexWorkspace(workspace);
  } catch (error) {
    throw new ToolError(errorMessage(error));
  }
  const files = allFiles.filter((file) => {
    if (scope === "") return true;
    const prefix = scope.endsWith("/") ? scope : `${scope}/`;
    return file === scope || file.startsWith(prefix);
  });

  const matches: string[] = [];
  fileLoop: for (const file of files) {
    if (matches.length >= GREP_MATCH_LIMIT) break;
    let data: Buffer;
    try {
      data = fs.readFileSync(resolvePath(workspace, file));
    } catch {
      continue;
    }
    if (data.length >= 2_000_000 || looksBinary(data)) continue;
    const content = data.toString("utf8");
    const lines = content.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!regex.test(line)) continue;
      const trimmed = takeCodePoints(line.trim(), 200);
      matches.push(`${file}:${index + 1}: ${trimmed}`);
      if (matches.length >= GREP_MATCH_LIMIT) {
        matches.push(
          `[Stopped at ${GREP_MATCH_LIMIT} matches — narrow the pattern or path]`,
        );
        break fileLoop;
      }
    }
  }
  return matches.length === 0 ? "No matches." : matches.join("\n");
}
