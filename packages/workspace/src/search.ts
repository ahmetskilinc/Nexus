import * as fs from "node:fs";
import * as path from "node:path";
import { indexWorkspace } from "./indexer";

const MAX_RESULTS = 100;
const MAX_FILE_BYTES = 2_000_000;

export type WorkspaceTextMatch = {
  path: string;
  line: number;
  text: string;
};

/// Searches the safe workspace index for literal text. This is deliberately not
/// a regex API: a UI search box should never turn an accidental character into
/// an expensive pattern. Large and binary-looking files are skipped.
export async function searchWorkspaceText(
  workspace: string,
  query: string,
  limit = MAX_RESULTS,
): Promise<WorkspaceTextMatch[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const matches: WorkspaceTextMatch[] = [];
  for (const relativePath of await indexWorkspace(workspace)) {
    if (matches.length >= limit) break;
    let data: Buffer;
    try {
      data = await fs.promises.readFile(path.join(workspace, relativePath));
    } catch {
      continue;
    }
    if (data.length > MAX_FILE_BYTES || data.subarray(0, 8192).includes(0))
      continue;
    const lines = data.toString("utf8").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index]?.toLowerCase().includes(needle)) continue;
      matches.push({
        path: relativePath,
        line: index + 1,
        text: lines[index]?.trim().slice(0, 240) ?? "",
      });
      if (matches.length >= limit) break;
    }
  }
  return matches;
}
