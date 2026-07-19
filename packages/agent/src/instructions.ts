/// Workspace instructions: an optional per-project prompt supplement loaded
/// from a conventional file at the workspace root, plus a user-provided
/// override edited in Settings. Both are appended to the system prompt under a
/// "Workspace instructions" header — purely additive, never rewriting the
/// base prompt.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/// Candidate filenames, in precedence order: the first one present at the
/// workspace root wins. Matched case-insensitively against the root's entries.
const CANDIDATES = ["AGENTS.md", ".nexus.md", "CLAUDE.md"];

/// Hard cap on the loaded file (bytes). Longer files are truncated so a stray
/// large document can't blow out the context window. Truncation lands on a
/// UTF-8 character boundary.
const MAX_BYTES = 8 * 1024;

const HEADER = "Workspace instructions";

export type LoadedInstructions = {
  source: string;
  text: string;
  truncated: boolean;
};

/// Reads the winning instruction file with provenance for the context
/// inspector.
export function loadInstructionFileInfo(
  workspace: string,
): LoadedInstructions | undefined {
  const byName = new Map<string, { source: string; filePath: string }>();
  let entries: string[];
  try {
    entries = readdirSync(workspace);
  } catch {
    return undefined;
  }
  for (const name of entries) {
    const filePath = path.join(workspace, name);
    try {
      if (!statSync(filePath).isFile()) continue;
    } catch {
      continue;
    }
    const key = name.toLowerCase();
    if (!byName.has(key)) byName.set(key, { source: name, filePath });
  }
  for (const candidate of CANDIDATES) {
    const found = byName.get(candidate.toLowerCase());
    if (!found) continue;
    let raw: Buffer;
    try {
      raw = readFileSync(found.filePath);
    } catch {
      continue;
    }
    const truncated = raw.length > MAX_BYTES;
    const capped = cap(raw);
    if (capped.trim().length > 0)
      return { source: found.source, text: capped, truncated };
  }
  return undefined;
}

export function loadInstructionFile(workspace: string): string | undefined {
  return loadInstructionFileInfo(workspace)?.text;
}

/// Truncates to at most MAX_BYTES, backing up to a UTF-8 character boundary
/// (a continuation byte is 0b10xxxxxx) so the result is always valid text.
function cap(raw: Buffer): string {
  if (raw.length <= MAX_BYTES) return raw.toString("utf8");
  let end = MAX_BYTES;
  while (end > 0 && ((raw[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return raw.subarray(0, end).toString("utf8");
}

/// Builds the combined system prompt: the `base`, then the workspace `file`,
/// then the user `overrideText`, with the two supplements sharing one header.
/// Empty or whitespace-only supplements are skipped; when both are absent the
/// base is returned unchanged.
export function augment(
  base: string,
  file: string | undefined,
  overrideText: string | undefined,
): string {
  const sections: string[] = [];
  for (const text of [file, overrideText]) {
    const trimmed = text?.trim();
    if (trimmed) sections.push(trimmed);
  }
  if (sections.length === 0) return base;
  return `${base}\n\n# ${HEADER}\n\n${sections.join("\n\n")}`;
}
