import * as fs from "node:fs";
import * as path from "node:path";
import { RuntimeError } from "@nexus/protocol";
import {
  type CheckpointEntry,
  readCheckpoint,
  type StoreOptions,
  safeTarget,
  storePath,
  writeCheckpoint,
} from "./store";

/// Restores a checkpoint — every entry, or only the selected
/// workspace-relative `paths`. Restore is guarded: every selected file must
/// still match its recorded post-image before any write, otherwise the whole
/// restore aborts. Restored entries are pruned from the stored checkpoint
/// afterwards, so the run's remaining files stay individually restorable (and
/// a pruned whole-run restore no longer trips the divergence guard on
/// already-reverted files).
export async function restoreCheckpoint(
  workspace: string,
  checkpointId: string,
  paths: string[] | null = null,
  options?: StoreOptions,
): Promise<string[]> {
  const checkpoint = readCheckpoint(workspace, checkpointId, options);
  const selected: CheckpointEntry[] = paths
    ? paths.map((requested) => {
        const entry = checkpoint.entries.find(
          (candidate) => candidate.path === requested,
        );
        if (!entry) {
          throw RuntimeError.msg(
            `${requested} is not part of this checkpoint.`,
          );
        }
        return { ...entry };
      })
    : checkpoint.entries.map((entry) => ({ ...entry }));

  // Fail the entire restore before touching disk if any selected file
  // diverged.
  for (const entry of selected) {
    const target = safeTarget(workspace, entry.path);
    let current: string | null = null;
    if (isFile(target)) {
      try {
        current = fs.readFileSync(target, "utf8");
      } catch {
        throw RuntimeError.msg(
          `${entry.path} is no longer a readable text file; checkpoint restore stopped.`,
        );
      }
    }
    if (current !== entry.after) {
      throw RuntimeError.msg(
        `${entry.path} changed after this run; checkpoint restore stopped without overwriting it.`,
      );
    }
  }

  // Apply in reverse mutation order so a rename's destination is removed
  // before its source is rewritten.
  for (const entry of [...selected].reverse()) {
    const target = safeTarget(workspace, entry.path);
    if (entry.before !== null) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, entry.before);
    } else if (fs.existsSync(target)) {
      fs.unlinkSync(target);
    }
  }

  const restored = selected.map((entry) => entry.path);
  checkpoint.entries = checkpoint.entries.filter(
    (entry) => !restored.includes(entry.path),
  );
  if (checkpoint.entries.length === 0) {
    try {
      fs.unlinkSync(storePath(workspace, checkpointId, options));
    } catch {
      // A missing store file is already the desired end state.
    }
  } else {
    writeCheckpoint(workspace, checkpoint, options);
  }
  return restored;
}

function isFile(target: string): boolean {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}
