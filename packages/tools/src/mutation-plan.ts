/// Disk-changing tools, split into plan (compute the change, nothing written)
/// and apply (write a previously approved plan). The split lets the agent loop
/// gate every mutation behind user approval with a real before/after diff.

import * as fs from "node:fs";
import {
  asArray,
  asBoolean,
  asRecord,
  asString,
  ToolError,
} from "@nexus/protocol";
import { resolveForWrite, resolvePath } from "./path";
import { errorMessage, looksBinary } from "./util";

/// A pending change computed by `planMutation` but not yet written. Holding
/// the before/after content lets the UI render a diff for approval before
/// anything touches disk, and lets `applyMutation` write without recomputing.
export interface MutationPlan {
  /// Workspace-relative path, for display and event payloads.
  path: string;
  /// Absolute target path the mutation writes to or deletes.
  target: string;
  /// Current file content ("" when the file is new).
  before: string;
  /// Whether the target existed when this plan was built. Kept separately
  /// because an existing empty file and a new file have the same text image.
  beforeExists: boolean;
  /// New content, or null for a deletion.
  after: string | null;
  /// When set, the mutation is a rename: `source` is moved to `target`
  /// instead of writing `after`. `before`/`after` still hold the (unchanged)
  /// content so the approval card can preview it.
  source: string | null;
  /// Confirmation returned to the model once the mutation is applied.
  message: string;
}

export function readText(target: string): string {
  try {
    return fs.readFileSync(target).toString("utf8");
  } catch {
    return "";
  }
}

/// Computes a mutation without applying it. Throws a ToolError with a
/// human-readable sentence on failure so the agent loop can surface it as a
/// tool result.
export async function planMutation(
  workspace: string,
  name: string,
  args: unknown,
): Promise<MutationPlan> {
  const record = asRecord(args) ?? {};
  switch (name) {
    case "write_file":
      return planWrite(workspace, record);
    case "create_file":
      return planCreate(workspace, record);
    case "edit_file":
      return planEdit(workspace, record);
    case "delete_file":
      return planDelete(workspace, record);
    case "multi_edit":
      return planMultiEdit(workspace, record);
    case "rename_file":
      return planRename(workspace, record);
    default:
      throw new ToolError(`unknown tool "${name}".`);
  }
}

const countOccurrences = (haystack: string, needle: string) =>
  haystack.split(needle).length - 1;

/// String replacement without `$`-substitution surprises in the replacement.
const replaceFirst = (text: string, from: string, to: string) =>
  text.replace(from, () => to);
const replaceEvery = (text: string, from: string, to: string) =>
  text.replaceAll(from, () => to);

function requireString(args: Record<string, unknown>, key: string): string {
  const value = asString(args[key]);
  if (value === undefined) throw new ToolError(`"${key}" is required.`);
  return value;
}

function readEditable(path: string, target: string): string {
  let data: Buffer;
  try {
    data = fs.readFileSync(target);
  } catch (error) {
    throw new ToolError(errorMessage(error));
  }
  if (looksBinary(data)) {
    throw new ToolError(`"${path}" is a binary file and cannot be edited.`);
  }
  return data.toString("utf8");
}

function planWrite(
  workspace: string,
  args: Record<string, unknown>,
): MutationPlan {
  const path = requireString(args, "path");
  const content = requireString(args, "content");
  const target = resolveForWrite(workspace, path);
  const existed = fs.existsSync(target);
  const before = existed ? readText(target) : "";
  const message = existed ? `Wrote ${path}.` : `Created ${path}.`;
  return {
    path,
    target,
    before,
    beforeExists: existed,
    after: content,
    source: null,
    message,
  };
}

function planCreate(
  workspace: string,
  args: Record<string, unknown>,
): MutationPlan {
  const path = requireString(args, "path");
  const content = asString(args.content) ?? "";
  const target = resolveForWrite(workspace, path);
  if (fs.existsSync(target)) {
    throw new ToolError(
      `"${path}" already exists. Use write_file to overwrite it.`,
    );
  }
  return {
    path,
    target,
    before: "",
    beforeExists: false,
    after: content,
    source: null,
    message: `Created ${path}.`,
  };
}

function planEdit(
  workspace: string,
  args: Record<string, unknown>,
): MutationPlan {
  const path = requireString(args, "path");
  const oldString = requireString(args, "old_string");
  const newString = requireString(args, "new_string");
  if (oldString === "") throw new ToolError('"old_string" must not be empty.');
  const replaceAll = asBoolean(args.replace_all) ?? false;
  const target = resolvePath(workspace, path);
  const before = readEditable(path, target);
  const count = countOccurrences(before, oldString);
  if (count === 0) {
    throw new ToolError(`The text to replace was not found in ${path}.`);
  }
  if (count > 1 && !replaceAll) {
    throw new ToolError(
      `The text to replace appears ${count} times in ${path}; add surrounding context to make it unique, or pass replace_all.`,
    );
  }
  const after = replaceAll
    ? replaceEvery(before, oldString, newString)
    : replaceFirst(before, oldString, newString);
  const replacements = replaceAll ? count : 1;
  return {
    path,
    target,
    before,
    beforeExists: true,
    after,
    source: null,
    message: `Edited ${path} (${replacements} replacement${replacements === 1 ? "" : "s"}).`,
  };
}

function planDelete(
  workspace: string,
  args: Record<string, unknown>,
): MutationPlan {
  const path = requireString(args, "path");
  const target = resolvePath(workspace, path);
  if (fs.statSync(target).isDirectory()) {
    throw new ToolError(`"${path}" is a directory; only files can be deleted.`);
  }
  return {
    path,
    target,
    before: readText(target),
    beforeExists: true,
    after: null,
    source: null,
    message: `Deleted ${path}.`,
  };
}

function planMultiEdit(
  workspace: string,
  args: Record<string, unknown>,
): MutationPlan {
  const path = requireString(args, "path");
  const edits = asArray(args.edits);
  if (edits === undefined || edits.length === 0) {
    throw new ToolError('"edits" must be a non-empty array.');
  }
  const target = resolvePath(workspace, path);
  const before = readEditable(path, target);

  let current = before;
  for (let index = 0; index < edits.length; index += 1) {
    const edit = asRecord(edits[index]) ?? {};
    const oldString = asString(edit.old_string);
    if (oldString === undefined) {
      throw new ToolError(`Edit ${index + 1} is missing "old_string".`);
    }
    const newString = asString(edit.new_string);
    if (newString === undefined) {
      throw new ToolError(`Edit ${index + 1} is missing "new_string".`);
    }
    if (oldString === "") {
      throw new ToolError(`Edit ${index + 1} has an empty "old_string".`);
    }
    const replaceAll = asBoolean(edit.replace_all) ?? false;
    const count = countOccurrences(current, oldString);
    if (count === 0) {
      throw new ToolError(
        `Edit ${index + 1} did not match anything in ${path} (after earlier edits).`,
      );
    }
    if (count > 1 && !replaceAll) {
      throw new ToolError(
        `Edit ${index + 1} matches ${count} places in ${path}; add context to make it unique, or set replace_all.`,
      );
    }
    current = replaceAll
      ? replaceEvery(current, oldString, newString)
      : replaceFirst(current, oldString, newString);
  }

  const count = edits.length;
  return {
    path,
    target,
    before,
    beforeExists: true,
    after: current,
    source: null,
    message: `Edited ${path} (${count} edit${count === 1 ? "" : "s"}).`,
  };
}

function planRename(
  workspace: string,
  args: Record<string, unknown>,
): MutationPlan {
  const from = requireString(args, "from");
  const to = requireString(args, "to");
  const source = resolvePath(workspace, from);
  if (fs.statSync(source).isDirectory()) {
    throw new ToolError(`"${from}" is a directory; only files can be renamed.`);
  }
  const target = resolveForWrite(workspace, to);
  if (fs.existsSync(target)) {
    throw new ToolError(
      `"${to}" already exists; choose a destination that is free.`,
    );
  }
  const content = readText(source);
  return {
    path: `${from} → ${to}`,
    target,
    before: content,
    beforeExists: false,
    after: content,
    source,
    message: `Renamed ${from} to ${to}.`,
  };
}
