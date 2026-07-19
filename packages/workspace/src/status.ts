import type { WorkspaceChange } from "@nexus/protocol";
import { runGit } from "./git";

/// Parses `git status --porcelain=v1 -z`. Entries are NUL-separated
/// `XY path` records; a rename contributes a second record (the original
/// path) that must be consumed alongside it.
export async function workspaceChanges(
  workspace: string,
): Promise<WorkspaceChange[]> {
  const output = await runGit(workspace, ["status", "--porcelain=v1", "-z"]);
  if (!output.success) return [];

  const changes: WorkspaceChange[] = [];
  const records = splitNul(output.stdout);
  for (let index = 0; index < records.length; index += 1) {
    const entry = records[index];
    if (entry.length < 4) continue;
    const code = entry.subarray(0, 2).toString("utf8");
    const entryPath = entry.subarray(3).toString("utf8");
    changes.push({
      path: entryPath,
      status: statusFromCode(code),
      staged: code[0] !== " " && code[0] !== "?" && code[0] !== "!",
      unstaged: code[1] !== " " || code === "??",
    });
    if (code[0] === "R" || code[1] === "R") index += 1;
  }
  return changes;
}

export function statusFromCode(code: string): WorkspaceChange["status"] {
  if (code === "??") return "untracked";
  if (code === "!!") return "ignored";
  if (code[0] === "U" || code[1] === "U" || code === "AA" || code === "DD") {
    return "conflicted";
  }
  if (code[0] === "D" || code[1] === "D") return "deleted";
  if (code[0] === "R" || code[1] === "R") return "renamed";
  if (code[0] === "A" || code[1] === "A") return "added";
  return "modified";
}

function splitNul(buffer: Buffer): Buffer[] {
  const records: Buffer[] = [];
  let start = 0;
  for (let index = 0; index <= buffer.length; index += 1) {
    if (index === buffer.length || buffer[index] === 0) {
      records.push(buffer.subarray(start, index));
      start = index + 1;
    }
  }
  return records;
}
