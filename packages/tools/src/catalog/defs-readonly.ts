/// Read-only tool schemas. Descriptions are byte-faithful to the Rust
/// catalog — they are sent verbatim to LLM APIs.

import type { ToolSchema } from "./kinds";

export const READONLY_TOOLS: readonly ToolSchema[] = [
  {
    name: "read_file",
    description:
      "Read a UTF-8 text file from the workspace. Returns the full content, optionally restricted to a line range.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path." },
        start_line: {
          type: "integer",
          description:
            "First line to read (1-based). Omit to read from the start.",
        },
        end_line: {
          type: "integer",
          description:
            "Last line to read (inclusive). Omit to read to the end.",
        },
      },
      required: ["path"],
    },
    kind: "readOnly",
  },
  {
    name: "list_directory",
    description:
      "List the entries of a workspace directory. Directories are marked with a trailing slash.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            'Workspace-relative directory path. Omit or pass "" for the workspace root.',
        },
      },
      required: [],
    },
    kind: "readOnly",
  },
  {
    name: "grep",
    description:
      "Search file contents across the workspace with a regular expression. Returns up to 100 matches as path:line: text.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Regular expression to search for.",
        },
        path: {
          type: "string",
          description:
            "Optional workspace-relative path prefix to restrict the search.",
        },
      },
      required: ["pattern"],
    },
    kind: "readOnly",
  },
  {
    name: "git_status",
    description: "Run `git status --short --branch` in the workspace.",
    parameters: { type: "object", properties: {}, required: [] },
    kind: "readOnly",
  },
  {
    name: "git_diff",
    description:
      "Show uncommitted changes as a unified diff. By default diffs the working tree against HEAD; pass staged:true for the index only. Restrict to one file with `path`.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Optional workspace-relative file path to restrict the diff to.",
        },
        staged: {
          type: "boolean",
          description:
            "Diff only staged changes (git diff --cached). Defaults to false.",
        },
      },
      required: [],
    },
    kind: "readOnly",
  },
  {
    name: "glob",
    description:
      'Find files by name using a glob pattern (e.g. "**/*.rs", "src/**/test_*.ts"). Supports * (within a segment), ** (across directories), and ?. Returns up to 200 matching workspace-relative paths. Use this to locate files by name; use grep to search file contents.',
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description:
            "Glob pattern to match against workspace-relative paths.",
        },
        path: {
          type: "string",
          description:
            "Optional workspace-relative directory to restrict the search to.",
        },
      },
      required: ["pattern"],
    },
    kind: "readOnly",
  },
] as const;
