import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { RuntimeError } from "@nexus/protocol";
import { isWorkspaceRelative } from "../git";

export type CheckpointEntry = {
  path: string;
  /// Pre-image, or null when the file did not exist before the run.
  before: string | null;
  /// Post-image, or null when the mutation deleted the file.
  after: string | null;
};

export type Checkpoint = {
  id: string;
  createdAt: number;
  entries: CheckpointEntry[];
};

/// Lets tests point the store somewhere disposable; the OS data dir is the
/// fallback.
export type StoreOptions = {
  dataDir?: string;
};

/// The per-OS base data directory (the parent of `dev.nexus.app`), or null
/// when the platform's home/data dir can't be located.
export function defaultDataDir(): string | null {
  if (process.platform === "darwin") {
    const home = process.env.HOME;
    return home ? path.join(home, "Library/Application Support") : null;
  }
  if (process.platform === "win32") {
    return process.env.APPDATA ?? null;
  }
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg) return xdg;
  const home = process.env.HOME;
  return home ? path.join(home, ".local/share") : null;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/// Canonicalize so the same repo maps to one store regardless of how the path
/// was spelled; fall back to the raw path when it can't be resolved.
export function canonicalWorkspacePath(workspace: string): string {
  try {
    return fs.realpathSync(workspace);
  } catch {
    return workspace;
  }
}

export function storePath(
  workspace: string,
  id: string,
  options?: StoreOptions,
): string {
  const base = options?.dataDir ?? defaultDataDir();
  if (!base) {
    throw RuntimeError.msg("Checkpoint storage is unavailable.");
  }
  const root = path.join(base, "dev.nexus.app", "checkpoints");
  return path.join(
    root,
    sha256Hex(canonicalWorkspacePath(workspace)),
    `${sha256Hex(id)}.json`,
  );
}

/// Atomic write: serialize to a sibling `.tmp` file, then rename over the
/// final path so a crash never leaves a truncated checkpoint.
export function writeCheckpoint(
  workspace: string,
  checkpoint: Checkpoint,
  options?: StoreOptions,
): void {
  const target = storePath(workspace, checkpoint.id, options);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const body = JSON.stringify(checkpoint);
  const temporary = target.replace(/\.json$/, ".tmp");
  fs.writeFileSync(temporary, body);
  fs.renameSync(temporary, target);
}

export function readCheckpoint(
  workspace: string,
  id: string,
  options?: StoreOptions,
): Checkpoint {
  const target = storePath(workspace, id, options);
  let data: string;
  try {
    data = fs.readFileSync(target, "utf8");
  } catch {
    throw RuntimeError.msg("This checkpoint is no longer available.");
  }
  const malformed = RuntimeError.msg(
    "This checkpoint is malformed and cannot be restored.",
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw malformed;
  }
  if (typeof parsed !== "object" || parsed === null) throw malformed;
  const record = parsed as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.createdAt !== "number" ||
    !Array.isArray(record.entries)
  ) {
    throw malformed;
  }
  const entries: CheckpointEntry[] = [];
  for (const raw of record.entries) {
    if (typeof raw !== "object" || raw === null) throw malformed;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.path !== "string") throw malformed;
    if (entry.before != null && typeof entry.before !== "string") {
      throw malformed;
    }
    if (entry.after != null && typeof entry.after !== "string") {
      throw malformed;
    }
    entries.push({
      path: entry.path,
      before: (entry.before as string | null | undefined) ?? null,
      after: (entry.after as string | null | undefined) ?? null,
    });
  }
  return { id: record.id, createdAt: record.createdAt, entries };
}

/// Resolves a checkpoint entry's workspace path, refusing anything that could
/// write outside the workspace: absolute or `..`-escaping components, and
/// existing symlinks (which would redirect the restore write).
export function safeTarget(workspace: string, relative: string): string {
  if (relative === "" || !isWorkspaceRelative(relative)) {
    throw RuntimeError.msg("Checkpoint path is outside the workspace.");
  }
  const target = path.join(workspace, relative);
  let isSymlink = false;
  try {
    isSymlink = fs.lstatSync(target).isSymbolicLink();
  } catch {
    // A missing target is fine — restore may be recreating a deleted file.
  }
  if (isSymlink) {
    throw RuntimeError.msg("Checkpoint target is a symbolic link.");
  }
  return target;
}
