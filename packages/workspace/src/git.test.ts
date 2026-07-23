import { afterEach, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  branchSync,
  commitChanges,
  pushCommits,
  stageFiles,
  unstageFiles,
  validateRelativePath,
} from "./git";
import { workspaceChanges } from "./status";

const gitAvailable =
  spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0;

const created: string[] = [];

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function gitFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-git-action-test-"));
  created.push(dir);
  const git = (args: string[]) => {
    execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  };
  git(["init", "-q"]);
  git(["config", "user.email", "nexus@example.test"]);
  git(["config", "user.name", "Nexus Test"]);
  git(["config", "commit.gpgsign", "false"]);
  return dir;
}

test.skipIf(!gitAvailable)("git actions stage unstage and commit", async () => {
  const dir = gitFixture();
  fs.writeFileSync(path.join(dir, "note.txt"), "one\n");

  await stageFiles(dir, ["note.txt"]);
  const staged = await workspaceChanges(dir);
  expect(
    staged.some((change) => change.path === "note.txt" && change.staged),
  ).toBe(true);

  await unstageFiles(dir, ["note.txt"]);
  const unstaged = await workspaceChanges(dir);
  expect(
    unstaged.some((change) => change.path === "note.txt" && change.unstaged),
  ).toBe(true);

  await stageFiles(dir, ["note.txt"]);
  await commitChanges(dir, "Add note");
  expect(await workspaceChanges(dir)).toEqual([]);
});

test.skipIf(!gitAvailable)(
  "push publishes an untracked branch then reports it in sync",
  async () => {
    const dir = gitFixture();
    fs.writeFileSync(path.join(dir, "note.txt"), "one\n");
    await stageFiles(dir, ["note.txt"]);
    await commitChanges(dir, "Add note");

    const untracked = await branchSync(dir);
    expect(untracked.branch).not.toBeNull();
    expect(untracked.upstream).toBeNull();
    expect(untracked.hasRemote).toBe(false);
    // Nothing to push to yet.
    await expect(pushCommits(dir)).rejects.toThrow("no remote");

    const remote = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-git-remote-"));
    created.push(remote);
    execFileSync("git", ["init", "-q", "--bare", remote], { stdio: "ignore" });
    execFileSync("git", ["remote", "add", "origin", remote], {
      cwd: dir,
      stdio: "ignore",
    });

    // First push has no upstream, so it must publish the branch.
    const published = await pushCommits(dir);
    expect(published.upstream).toBe(`origin/${untracked.branch}`);
    expect(published.ahead).toBe(0);
    expect(published.hasRemote).toBe(true);

    fs.writeFileSync(path.join(dir, "note.txt"), "two\n");
    await stageFiles(dir, ["note.txt"]);
    await commitChanges(dir, "Edit note");
    expect((await branchSync(dir)).ahead).toBe(1);
    expect((await pushCommits(dir)).ahead).toBe(0);
  },
);

test("git diff rejects paths outside the workspace", () => {
  expect(() => validateRelativePath("src/main.rs")).not.toThrow();
  expect(() => validateRelativePath("../outside.rs")).toThrow(
    "The requested file is outside the workspace.",
  );
  expect(() => validateRelativePath("/etc/passwd")).toThrow(
    "The requested file is outside the workspace.",
  );
  expect(() => validateRelativePath("")).toThrow(
    "A workspace-relative file path is required.",
  );
});
