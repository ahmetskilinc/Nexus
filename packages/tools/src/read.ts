/// read_file and list_directory, dispatched through `Toolbox.execute`.

import * as fs from "node:fs";
import { asNumber, asString, ToolError } from "@nexus/protocol";
import { resolvePath } from "./path";
import { errorMessage, looksBinary } from "./util";
import { naturalCompare } from "./workspace-index";

export function readFileTool(
  workspace: string,
  args: Record<string, unknown>,
): string {
  const path = asString(args.path);
  if (path === undefined) throw new ToolError('"path" is required.');
  const target = resolvePath(workspace, path);
  let data: Buffer;
  try {
    data = fs.readFileSync(target);
  } catch (error) {
    throw new ToolError(errorMessage(error));
  }
  if (looksBinary(data)) {
    return "This is a binary file; its content cannot be displayed.";
  }
  const text = data.toString("utf8");

  if (!("start_line" in args) && !("end_line" in args)) return text;
  const lines = text.split("\n");
  // Match Rust's integer coercions: non-integers fall back to the default,
  // a negative start clamps to 1, a negative end wraps past the file length
  // (`as usize`) and then clamps down to it.
  const startRaw = asNumber(args.start_line);
  const start = Math.max(
    startRaw !== undefined && Number.isInteger(startRaw) ? startRaw : 1,
    1,
  );
  const endRaw = asNumber(args.end_line);
  const end =
    endRaw !== undefined && Number.isInteger(endRaw) && endRaw >= 0
      ? Math.min(endRaw, lines.length)
      : lines.length;
  if (start > end || start > lines.length) {
    throw new ToolError(
      `the requested line range is outside the file (${lines.length} lines).`,
    );
  }
  return lines
    .slice(start - 1, end)
    .map((line, offset) => `${offset + start}\t${line}`)
    .join("\n");
}

export function listDirectoryTool(
  workspace: string,
  args: Record<string, unknown>,
): string {
  const path = asString(args.path) ?? "";
  const target = resolvePath(workspace, path);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(target, { withFileTypes: true });
  } catch (error) {
    throw new ToolError(errorMessage(error));
  }
  const children: [string, boolean][] = entries
    .filter((entry) => !entry.name.startsWith("."))
    .map((entry) => [entry.name, entry.isDirectory()]);
  children.sort((a, b) => naturalCompare(a[0], b[0]));
  if (children.length === 0) return "The directory is empty.";
  return children
    .map(([name, isDir]) => (isDir ? `${name}/` : name))
    .join("\n");
}
