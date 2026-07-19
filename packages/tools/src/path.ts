/// Workspace-confinement path resolution shared by the read-only and mutating
/// tools: lexical `..` rejection plus symlink-aware canonicalization.

import * as fs from "node:fs";
import * as path from "node:path";
import { ToolError } from "@nexus/protocol";
import { errorMessage } from "./util";

export type PathComponent =
  | { kind: "normal"; value: string }
  | { kind: "current" }
  | { kind: "parent" }
  | { kind: "root" };

/// Splits a model-supplied relative path into components, mirroring Rust's
/// `Path::components()` closely enough for confinement decisions: absolute
/// paths and drive prefixes surface as `root`, `.`/`..` as their own kinds.
export function pathComponents(relative: string): PathComponent[] {
  const components: PathComponent[] = [];
  let rest = relative;
  if (process.platform === "win32" && /^[A-Za-z]:/.test(rest)) {
    components.push({ kind: "root" });
    rest = rest.slice(2);
  }
  const segments =
    process.platform === "win32" ? rest.split(/[\\/]/) : rest.split("/");
  if (rest !== "" && segments[0] === "") components.push({ kind: "root" });
  for (const segment of segments) {
    if (segment === "") continue;
    if (segment === ".") components.push({ kind: "current" });
    else if (segment === "..") components.push({ kind: "parent" });
    else components.push({ kind: "normal", value: segment });
  }
  return components;
}

/// Component-wise containment: `candidate` is `root` or lives beneath it.
function within(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

function canonicalizeWorkspace(workspace: string): string {
  try {
    return fs.realpathSync(workspace);
  } catch (error) {
    throw new ToolError(
      `The workspace could not be accessed: ${errorMessage(error)}`,
    );
  }
}

/// Lexically normalizes the relative path against the workspace root and
/// rejects anything that escapes it, without touching the filesystem. The
/// returned path is not guaranteed to exist.
function lexicalResolve(workspace: string, relative: string): string {
  const escaped = () =>
    new ToolError(`The path "${relative}" resolves outside the workspace.`);
  const parts: string[] = [];
  for (const component of pathComponents(relative)) {
    switch (component.kind) {
      case "normal":
        parts.push(component.value);
        break;
      case "current":
        break;
      case "parent":
        if (parts.length === 0) throw escaped();
        parts.pop();
        break;
      case "root":
        throw escaped();
    }
  }
  return parts.length === 0 ? workspace : path.join(workspace, ...parts);
}

/// Resolves a path that must already exist, canonicalizing it so symlinks
/// cannot redirect outside the workspace.
export function resolvePath(workspace: string, relative: string): string {
  const resolved = lexicalResolve(workspace, relative);
  const canonicalRoot = canonicalizeWorkspace(workspace);
  let canonical: string;
  try {
    canonical = fs.realpathSync(resolved);
  } catch (error) {
    throw new ToolError(
      `The path "${relative}" could not be accessed: ${errorMessage(error)}`,
    );
  }
  if (!within(canonicalRoot, canonical)) {
    throw new ToolError(
      `The path "${relative}" resolves outside the workspace.`,
    );
  }
  return canonical;
}

function isSymlink(target: string): boolean {
  try {
    return fs.lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
}

/// Resolves a path that may not exist yet (for creation). Since the leaf
/// cannot be canonicalized, this canonicalizes the deepest existing ancestor
/// and verifies it stays within the workspace — which, combined with the
/// lexical `..` guard, blocks symlinked intermediate directories.
export function resolveForWrite(workspace: string, relative: string): string {
  const resolved = lexicalResolve(workspace, relative);
  // Reject a symlinked final component: fs.writeFile/rename follow a leaf
  // symlink, so one pointing outside the workspace — even a dangling one,
  // which the ancestor-existence walk below skips — would let a write land
  // outside. lstat does not follow the link, so it flags the symlink itself.
  if (isSymlink(resolved)) {
    throw new ToolError(
      `The path "${relative}" is a symlink and cannot be written through.`,
    );
  }
  const canonicalRoot = canonicalizeWorkspace(workspace);
  let ancestor: string | null = resolved;
  while (ancestor !== null) {
    if (fs.existsSync(ancestor)) {
      let canonical: string;
      try {
        canonical = fs.realpathSync(ancestor);
      } catch (error) {
        throw new ToolError(
          `The path "${relative}" could not be accessed: ${errorMessage(error)}`,
        );
      }
      if (!within(canonicalRoot, canonical)) {
        throw new ToolError(
          `The path "${relative}" resolves outside the workspace.`,
        );
      }
      break;
    }
    const parent: string = path.dirname(ancestor);
    ancestor = parent === ancestor ? null : parent;
  }
  return resolved;
}

/// Re-validates an absolute write target at apply time, closing the TOCTOU
/// window between planning a mutation and writing it: a path component could
/// have been swapped for a symlink after the plan (and the user's approval)
/// were computed. Rejects a symlinked leaf and any nearest-existing ancestor
/// that canonicalizes outside the workspace.
export function verifyWriteTarget(workspace: string, target: string): void {
  if (isSymlink(target)) {
    throw new ToolError(
      "The write target is a symlink and cannot be written through.",
    );
  }
  const canonicalRoot = canonicalizeWorkspace(workspace);
  let ancestor: string | null = target;
  while (ancestor !== null) {
    if (fs.existsSync(ancestor)) {
      let canonical: string;
      try {
        canonical = fs.realpathSync(ancestor);
      } catch (error) {
        throw new ToolError(
          `The write target could not be accessed: ${errorMessage(error)}`,
        );
      }
      if (!within(canonicalRoot, canonical)) {
        throw new ToolError("The write target resolves outside the workspace.");
      }
      return;
    }
    const parent: string = path.dirname(ancestor);
    ancestor = parent === ancestor ? null : parent;
  }
}
