import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CheckpointRecorder } from "./recorder";
import { restoreCheckpoint, restoreLatestMutation } from "./restore";
import { safeTarget, storePath } from "./store";

const created: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function fixture(prefix: string): {
  workspace: string;
  options: { dataDir: string };
} {
  return {
    workspace: tempDir(prefix),
    options: { dataDir: tempDir(`${prefix}data-`) },
  };
}

test("restore reverts when post-image still matches", async () => {
  const { workspace, options } = fixture("nexus-checkpoint-test-");
  fs.writeFileSync(path.join(workspace, "file.txt"), "after");
  const recorder = new CheckpointRecorder(workspace, "restore", options);
  recorder.record([{ path: "file.txt", before: "before", after: "after" }]);

  await restoreCheckpoint(workspace, "restore", null, options);
  expect(fs.readFileSync(path.join(workspace, "file.txt"), "utf8")).toBe(
    "before",
  );
});

test("restore refuses diverged files without overwriting", async () => {
  const { workspace, options } = fixture("nexus-checkpoint-diverged-test-");
  fs.writeFileSync(path.join(workspace, "file.txt"), "after");
  const recorder = new CheckpointRecorder(workspace, "diverged", options);
  recorder.record([{ path: "file.txt", before: "before", after: "after" }]);

  fs.writeFileSync(path.join(workspace, "file.txt"), "user edit");
  expect(
    restoreCheckpoint(workspace, "diverged", null, options),
  ).rejects.toThrow(
    "file.txt changed after this run; checkpoint restore stopped without overwriting it.",
  );
  expect(fs.readFileSync(path.join(workspace, "file.txt"), "utf8")).toBe(
    "user edit",
  );
});

test("a diverged file refuses the whole restore before any write", async () => {
  const { workspace, options } = fixture("nexus-checkpoint-guard-test-");
  fs.writeFileSync(path.join(workspace, "clean.txt"), "clean after");
  fs.writeFileSync(path.join(workspace, "dirty.txt"), "dirty after");
  const recorder = new CheckpointRecorder(workspace, "guard", options);
  recorder.record([
    { path: "clean.txt", before: "clean before", after: "clean after" },
    { path: "dirty.txt", before: "dirty before", after: "dirty after" },
  ]);

  fs.writeFileSync(path.join(workspace, "dirty.txt"), "user edit");
  expect(restoreCheckpoint(workspace, "guard", null, options)).rejects.toThrow(
    "dirty.txt changed after this run; checkpoint restore stopped without overwriting it.",
  );
  // The clean file was not reverted either — the guard runs before any write.
  expect(fs.readFileSync(path.join(workspace, "clean.txt"), "utf8")).toBe(
    "clean after",
  );
});

test("per-file restore reverts only the selected path", async () => {
  const { workspace, options } = fixture("nexus-checkpoint-per-file-test-");
  fs.writeFileSync(path.join(workspace, "one.txt"), "one after");
  fs.writeFileSync(path.join(workspace, "two.txt"), "two after");
  const recorder = new CheckpointRecorder(workspace, "per-file", options);
  recorder.record([
    { path: "one.txt", before: "one before", after: "one after" },
    { path: "two.txt", before: "two before", after: "two after" },
  ]);

  const restored = await restoreCheckpoint(
    workspace,
    "per-file",
    ["one.txt"],
    options,
  );
  expect(restored).toEqual(["one.txt"]);
  expect(fs.readFileSync(path.join(workspace, "one.txt"), "utf8")).toBe(
    "one before",
  );
  expect(fs.readFileSync(path.join(workspace, "two.txt"), "utf8")).toBe(
    "two after",
  );

  // The restored entry is pruned, so the remaining file — and a later
  // whole-run restore — are unaffected by the already-reverted one.
  const remaining = await restoreCheckpoint(
    workspace,
    "per-file",
    null,
    options,
  );
  expect(remaining).toEqual(["two.txt"]);
  expect(fs.readFileSync(path.join(workspace, "two.txt"), "utf8")).toBe(
    "two before",
  );

  // Everything restored: the checkpoint file is deleted and the run is gone.
  expect(fs.existsSync(storePath(workspace, "per-file", options))).toBe(false);
  expect(
    restoreCheckpoint(workspace, "per-file", null, options),
  ).rejects.toThrow("This checkpoint is no longer available.");

  // Selecting a path that was never part of the checkpoint errors.
  const other = new CheckpointRecorder(workspace, "unknown-path", options);
  other.record([{ path: "one.txt", before: "x", after: "one before" }]);
  expect(
    restoreCheckpoint(workspace, "unknown-path", ["missing.txt"], options),
  ).rejects.toThrow("missing.txt is not part of this checkpoint.");
});

test("restore recreates deleted files and deletes created ones", async () => {
  const { workspace, options } = fixture("nexus-checkpoint-create-test-");
  fs.writeFileSync(path.join(workspace, "created.txt"), "new content");
  const recorder = new CheckpointRecorder(workspace, "create", options);
  recorder.record([
    { path: "created.txt", before: null, after: "new content" },
    { path: "deleted.txt", before: "old content", after: null },
  ]);

  await restoreCheckpoint(workspace, "create", null, options);
  expect(fs.existsSync(path.join(workspace, "created.txt"))).toBe(false);
  expect(fs.readFileSync(path.join(workspace, "deleted.txt"), "utf8")).toBe(
    "old content",
  );
});

test("restoreLatestMutation reverts one step and retains earlier history", async () => {
  const { workspace, options } = fixture("nexus-checkpoint-step-undo-test-");
  fs.writeFileSync(path.join(workspace, "file.txt"), "v3");
  const recorder = new CheckpointRecorder(workspace, "step", options);
  recorder.record([{ path: "file.txt", before: "v1", after: "v2" }], {
    callId: "call-1",
    tool: "edit_file",
    appliedAt: 1,
  });
  recorder.record([{ path: "file.txt", before: "v2", after: "v3" }], {
    callId: "call-2",
    tool: "edit_file",
    appliedAt: 2,
  });

  await restoreLatestMutation(workspace, "step", "file.txt", options);
  expect(fs.readFileSync(path.join(workspace, "file.txt"), "utf8")).toBe("v2");
  await restoreLatestMutation(workspace, "step", "file.txt", options);
  expect(fs.readFileSync(path.join(workspace, "file.txt"), "utf8")).toBe("v1");
});

test("recorder stores secret-free mutation provenance", () => {
  const { workspace, options } = fixture("nexus-checkpoint-audit-test-");
  const recorder = new CheckpointRecorder(workspace, "audit", options);
  recorder.record([{ path: "file.txt", before: "before", after: "after" }], {
    callId: "call-1",
    tool: "edit_file",
    appliedAt: 123,
  });
  const stored = JSON.parse(
    fs.readFileSync(storePath(workspace, "audit", options), "utf8"),
  );
  expect(stored.entries[0]).toEqual({
    path: "file.txt",
    before: "before",
    after: "after",
    audit: { callId: "call-1", tool: "edit_file", appliedAt: 123 },
    history: [
      {
        before: "before",
        after: "after",
        audit: { callId: "call-1", tool: "edit_file", appliedAt: 123 },
      },
    ],
  });
});

test("safe target rejects escapes, absolute paths, and symlinks", () => {
  const workspace = tempDir("nexus-safe-target-test-");
  expect(() => safeTarget(workspace, "")).toThrow(
    "Checkpoint path is outside the workspace.",
  );
  expect(() => safeTarget(workspace, "../escape.txt")).toThrow(
    "Checkpoint path is outside the workspace.",
  );
  expect(() => safeTarget(workspace, "nested/../../escape.txt")).toThrow(
    "Checkpoint path is outside the workspace.",
  );
  expect(() => safeTarget(workspace, "/etc/passwd")).toThrow(
    "Checkpoint path is outside the workspace.",
  );

  fs.writeFileSync(path.join(workspace, "real.txt"), "x");
  fs.symlinkSync(
    path.join(workspace, "real.txt"),
    path.join(workspace, "link.txt"),
  );
  expect(() => safeTarget(workspace, "link.txt")).toThrow(
    "Checkpoint target is a symbolic link.",
  );
  expect(safeTarget(workspace, "real.txt")).toBe(
    path.join(workspace, "real.txt"),
  );
  // A missing target is fine — restore may be recreating a deleted file.
  expect(safeTarget(workspace, "missing.txt")).toBe(
    path.join(workspace, "missing.txt"),
  );
});

test("recorder plans, merges, and reports metadata", () => {
  const { workspace, options } = fixture("nexus-recorder-test-");
  const recorder = new CheckpointRecorder(workspace, "run", options);
  expect(recorder.metadata()).toBeNull();

  // A rename yields two entries: rewrite the source, delete the destination.
  const renameEntries = recorder.entriesFor({
    path: "new/name.txt",
    target: path.join(workspace, "new/name.txt"),
    before: "content",
    beforeExists: true,
    after: "content",
    source: path.join(workspace, "old/name.txt"),
  });
  expect(renameEntries).toEqual([
    { path: "old/name.txt", before: "content", after: null },
    { path: "new/name.txt", before: null, after: "content" },
  ]);

  // A rename that leaves the workspace records nothing.
  expect(
    recorder.entriesFor({
      path: "name.txt",
      target: path.join(workspace, "name.txt"),
      before: "content",
      beforeExists: true,
      after: "content",
      source: "/somewhere/else/name.txt",
    }),
  ).toEqual([]);

  // Re-recording a path keeps the original pre-image but advances the
  // expected post-image.
  recorder.record([{ path: "file.txt", before: "v1", after: "v2" }]);
  recorder.record([{ path: "file.txt", before: "v2", after: "v3" }]);
  recorder.record(
    recorder.entriesFor({
      path: "fresh.txt",
      target: path.join(workspace, "fresh.txt"),
      before: "",
      beforeExists: false,
      after: "fresh",
    }),
  );
  const metadata = recorder.metadata();
  expect(metadata?.id).toBe("run");
  expect(metadata?.files).toEqual(["file.txt", "fresh.txt"]);

  const stored = JSON.parse(
    fs.readFileSync(storePath(workspace, "run", options), "utf8"),
  );
  expect(stored.entries).toEqual([
    { path: "file.txt", before: "v1", after: "v3" },
    { path: "fresh.txt", before: null, after: "fresh" },
  ]);
});
