import * as fs from "node:fs";
import * as path from "node:path";
import { indexWorkspace } from "./indexer";

const MAX_FILES = 5000;
const MAX_SAMPLE_NAMES = 12;

export type ProjectMap = {
  files: number;
  languages: Array<{ language: string; files: number }>;
  topLevel: string[];
};

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  py: "Python",
  rs: "Rust",
  go: "Go",
  java: "Java",
  kt: "Kotlin",
  swift: "Swift",
  rb: "Ruby",
  php: "PHP",
  cs: "C#",
  cpp: "C++",
  c: "C",
  h: "C/C++",
  css: "CSS",
  html: "HTML",
  json: "JSON",
  md: "Markdown",
  yml: "YAML",
  yaml: "YAML",
  toml: "TOML",
};

/// Cheap, local repository orientation data. It avoids parsing source or
/// storing an index: callers can refresh it whenever the workspace changes.
export async function projectMap(workspace: string): Promise<ProjectMap> {
  const files = (await indexWorkspace(workspace)).slice(0, MAX_FILES);
  const counts = new Map<string, number>();
  for (const file of files) {
    const extension = path.extname(file).slice(1).toLowerCase();
    const language = LANGUAGE_BY_EXTENSION[extension] ?? "Other";
    counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  const topLevel = await fs.promises
    .readdir(workspace, { withFileTypes: true })
    .then((entries) =>
      entries
        .filter((entry) => !entry.name.startsWith("."))
        .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
        .sort()
        .slice(0, MAX_SAMPLE_NAMES),
    )
    .catch(() => []);
  return {
    files: files.length,
    languages: [...counts.entries()]
      .map(([language, count]) => ({ language, files: count }))
      .toSorted(
        (left, right) =>
          right.files - left.files ||
          left.language.localeCompare(right.language),
      ),
    topLevel,
  };
}
