/// Mutating tool schemas. Descriptions are byte-faithful to the Rust
/// catalog — they are sent verbatim to LLM APIs.

import type { ToolSchema } from "./kinds";

export const MUTATING_TOOLS: readonly ToolSchema[] = [
  {
    name: "write_file",
    description:
      "Create a file or overwrite an existing one with the given content. Prefer edit_file for changes to an existing file; use write_file for new files or full rewrites. Parent directories are created as needed.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path." },
        content: { type: "string", description: "The full new file content." },
      },
      required: ["path", "content"],
    },
    kind: "mutating",
  },
  {
    name: "edit_file",
    description:
      "Replace an exact substring in an existing file. `old_string` must match the file byte-for-byte and, unless `replace_all` is true, must be unique — include enough surrounding context to identify a single occurrence.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path." },
        old_string: {
          type: "string",
          description: "The exact text to replace.",
        },
        new_string: {
          type: "string",
          description: "The text to replace it with.",
        },
        replace_all: {
          type: "boolean",
          description:
            "Replace every occurrence instead of requiring a unique match. Defaults to false.",
        },
      },
      required: ["path", "old_string", "new_string"],
    },
    kind: "mutating",
  },
  {
    name: "create_file",
    description:
      "Create a new file. Fails if the file already exists; use write_file to overwrite. Parent directories are created as needed.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path." },
        content: {
          type: "string",
          description: "The initial file content. Omit for an empty file.",
        },
      },
      required: ["path"],
    },
    kind: "mutating",
  },
  {
    name: "delete_file",
    description:
      "Delete a file from the workspace. Only files can be deleted, not directories.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path." },
      },
      required: ["path"],
    },
    kind: "mutating",
  },
  {
    name: "multi_edit",
    description:
      "Apply several edits to a single file in one atomic operation. Each edit is an exact substring replacement, applied in order; every `old_string` must match after the previous edits are applied. Fails as a whole (no partial writes) if any edit does not match. Prefer this over repeated edit_file calls on the same file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path." },
        edits: {
          type: "array",
          description: "Edits applied in order.",
          items: {
            type: "object",
            properties: {
              old_string: {
                type: "string",
                description: "The exact text to replace.",
              },
              new_string: {
                type: "string",
                description: "The text to replace it with.",
              },
              replace_all: {
                type: "boolean",
                description: "Replace every occurrence. Defaults to false.",
              },
            },
            required: ["old_string", "new_string"],
          },
        },
      },
      required: ["path", "edits"],
    },
    kind: "mutating",
  },
  {
    name: "rename_file",
    description:
      "Move or rename a file within the workspace, preserving its content. Fails if the destination already exists. Parent directories of the destination are created as needed.",
    parameters: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description: "Existing workspace-relative file path.",
        },
        to: {
          type: "string",
          description: "New workspace-relative file path.",
        },
      },
      required: ["from", "to"],
    },
    kind: "mutating",
  },
] as const;
