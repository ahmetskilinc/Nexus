import * as fs from "node:fs";
import * as path from "node:path";
import { gitStatusSummary } from "./git";
import { naturalCompare } from "./natural-compare";

const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".build",
  ".swiftpm",
  "DerivedData",
  "node_modules",
  "Pods",
]);

/// Recursively lists workspace-relative file paths, skipping hidden entries
/// and common generated/dependency directories — same rules as the Swift index.
export async function indexWorkspace(workspace: string): Promise<string[]> {
  const files: string[] = [];
  await collectFiles(workspace, "", files);
  files.sort(naturalCompare);
  return files;
}

async function collectFiles(
  directory: string,
  relative: string,
  files: string[],
): Promise<void> {
  const children = await fs.promises.readdir(directory, {
    withFileTypes: true,
  });
  for (const child of children) {
    const name = child.name;
    if (name.startsWith(".")) continue;
    const relativePath = relative === "" ? name : `${relative}/${name}`;
    if (child.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(name)) continue;
      await collectFiles(path.join(directory, name), relativePath, files);
    } else if (child.isFile()) {
      files.push(relativePath);
    }
  }
}

export type InspectionReport = {
  workspaceSummary: string;
  gitSummary: string;
};

export async function inspectWorkspace(
  workspace: string,
): Promise<InspectionReport> {
  const entries = await fs.promises.readdir(workspace, {
    withFileTypes: true,
  });
  const children: Array<{ name: string; isDir: boolean }> = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    children.push({ name: entry.name, isDir: entry.isDirectory() });
  }
  children.sort((a, b) => naturalCompare(a.name, b.name));

  const count = children.length;
  const preview = children
    .slice(0, 30)
    .map(({ name, isDir }) => (isDir ? `[dir] ${name}` : name));
  const remaining = count - preview.length;

  const lines = [
    `${count} visible item${count === 1 ? "" : "s"} at the workspace root.`,
    ...preview,
  ];
  if (remaining > 0) {
    lines.push(`... and ${remaining} more`);
  }

  return {
    workspaceSummary: lines.join("\n"),
    gitSummary: await gitStatusSummary(workspace),
  };
}
