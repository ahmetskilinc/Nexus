import * as path from "node:path";
import {
  type Checkpoint,
  type CheckpointEntry,
  MAX_MUTATIONS_PER_FILE,
  type StoreOptions,
  writeCheckpoint,
} from "./store";

/// A successfully applied text-file mutation, as planned by the mutation
/// tools. Mirrors the Rust `MutationPlan` fields the recorder consumes.
export type MutationPlan = {
  /// Workspace-relative path, for display and event payloads.
  path: string;
  /// Absolute target path the mutation writes to or deletes.
  target: string;
  /// Current file content ("" when the file is new).
  before: string;
  /// Whether the target existed when this plan was built.
  beforeExists: boolean;
  /// New content, or null for a deletion.
  after: string | null;
  /// When set, the mutation is a rename: `source` is moved to `target`.
  source?: string | null;
};

export type CheckpointMetadata = {
  id: string;
  createdAt: number;
  files: string[];
  /// The last successful mutation that produced each file's post-image.
  entries: Array<{
    path: string;
    tool?: string;
    appliedAt?: number;
  }>;
};

/// Records every applied mutation of a run into one checkpoint file outside
/// the repository, so the whole run (or single files) can be reverted later.
export class CheckpointRecorder {
  private readonly workspace: string;
  private readonly options?: StoreOptions;
  private readonly checkpoint: Checkpoint;

  constructor(workspace: string, runId: string, options?: StoreOptions) {
    this.workspace = workspace;
    this.options = options;
    this.checkpoint = { id: runId, createdAt: Date.now(), entries: [] };
  }

  /// A rename yields two entries: the source (restored by rewriting it) and
  /// the destination (restored by deleting it). Renames that leave the
  /// workspace record nothing.
  entriesFor(plan: MutationPlan): CheckpointEntry[] {
    if (plan.source != null) {
      const from = relativeTo(this.workspace, plan.source);
      const to = relativeTo(this.workspace, plan.target);
      if (from === null || to === null) return [];
      return [
        { path: from, before: plan.before, after: null },
        { path: to, before: null, after: plan.after },
      ];
    }
    return [
      {
        path: plan.path,
        before: plan.beforeExists ? plan.before : null,
        after: plan.after,
      },
    ];
  }

  record(
    entries: CheckpointEntry[],
    audit?: { callId: string; tool: string; appliedAt?: number },
  ): void {
    for (const entry of entries) {
      const audited = audit
        ? {
            ...entry,
            audit: { ...audit, appliedAt: audit.appliedAt ?? Date.now() },
          }
        : entry;
      const existing = this.checkpoint.entries.find(
        (current) => current.path === audited.path,
      );
      if (existing) {
        // Keep the run's original pre-image while retaining each reversible
        // step. The history is newest-first and bounded so a pathological run
        // cannot grow unbounded local recovery storage.
        if (audited.audit) {
          existing.history = [
            {
              before: existing.after,
              after: audited.after,
              audit: audited.audit,
            },
            ...(existing.history ?? []),
          ].slice(0, MAX_MUTATIONS_PER_FILE);
        }
        existing.after = audited.after;
        existing.audit = audited.audit;
      } else {
        this.checkpoint.entries.push({
          ...audited,
          history: audited.audit
            ? [
                {
                  before: audited.before,
                  after: audited.after,
                  audit: audited.audit,
                },
              ]
            : undefined,
        });
      }
    }
    try {
      writeCheckpoint(this.workspace, this.checkpoint, this.options);
    } catch {
      // Persisting the checkpoint must never fail the mutation it records.
    }
  }

  metadata(): CheckpointMetadata | null {
    if (this.checkpoint.entries.length === 0) return null;
    return {
      id: this.checkpoint.id,
      createdAt: this.checkpoint.createdAt,
      files: this.checkpoint.entries.map((entry) => entry.path),
      entries: this.checkpoint.entries.map((entry) => ({
        path: entry.path,
        tool: entry.audit?.tool,
        appliedAt: entry.audit?.appliedAt,
      })),
    };
  }
}

/// Workspace-relative form of an absolute path, with forward slashes; null
/// when the path is not inside the workspace.
function relativeTo(workspace: string, target: string): string | null {
  const relative = path.relative(workspace, target);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return null;
  }
  return relative.split(path.sep).join("/");
}
