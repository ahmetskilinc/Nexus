import { afterEach, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  branchSync,
  commitChanges,
  createBranch,
  createTag,
  deleteBranch,
  pullFastForward,
  pushCommits,
  listTags,
  renameBranch,
  revertCommit,
  stageFiles,
  stashChanges,
  applyLatestStash,
  switchBranch,
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

test.skipIf(!gitAvailable)(
  "createBranch validates and checks out a new branch",
  async () => {
    const dir = gitFixture();
    fs.writeFileSync(path.join(dir, "note.txt"), "one\n");
    await stageFiles(dir, ["note.txt"]);
    await commitChanges(dir, "Initial commit");

    await createBranch(dir, "feature/nexus");
    expect((await branchSync(dir)).branch).toBe("feature/nexus");
    await expect(createBranch(dir, "-unsafe")).rejects.toThrow(
      "A valid branch name is required.",
    );
    await expect(createBranch(dir, "bad..branch")).rejects.toThrow(
      "A valid branch name is required.",
    );
  },
);

test.skipIf(!gitAvailable)(
  "renameBranch renames the checked-out branch",
  async () => {
    const dir = gitFixture();
    fs.writeFileSync(path.join(dir, "note.txt"), "one\n");
    await stageFiles(dir, ["note.txt"]);
    await commitChanges(dir, "Initial commit");
    const current = (await branchSync(dir)).branch;
    if (!current) throw new Error("expected branch");
    await renameBranch(dir, current, "renamed-main");
    expect((await branchSync(dir)).branch).toBe("renamed-main");
    await expect(
      renameBranch(dir, "renamed-main", "bad..branch"),
    ).rejects.toThrow("A valid branch name is required.");
  },
);

test.skipIf(!gitAvailable)(
  "deleteBranch refuses current but deletes merged branch",
  async () => {
    const dir = gitFixture();
    fs.writeFileSync(path.join(dir, "note.txt"), "one\n");
    await stageFiles(dir, ["note.txt"]);
    await commitChanges(dir, "Initial commit");
    const base = (await branchSync(dir)).branch;
    if (!base) throw new Error("expected branch");
    await createBranch(dir, "feature/nexus");
    await switchBranch(dir, base);
    await deleteBranch(dir, "feature/nexus");
    await expect(deleteBranch(dir, base)).rejects.toThrow(
      "Switch to another branch",
    );
  },
);

test.skipIf(!gitAvailable)(
  "switchBranch refuses a dirty working tree",
  async () => {
    const dir = gitFixture();
    fs.writeFileSync(path.join(dir, "note.txt"), "one\n");
    await stageFiles(dir, ["note.txt"]);
    await commitChanges(dir, "Initial commit");
    await createBranch(dir, "feature/nexus");
    fs.writeFileSync(path.join(dir, "note.txt"), "local edit\n");
    await expect(switchBranch(dir, "master")).rejects.toThrow(
      "working tree has changes",
    );
    expect((await branchSync(dir)).branch).toBe("feature/nexus");
  },
);

test.skipIf(!gitAvailable)(
  "pullFastForward refuses a dirty working tree",
  async () => {
    const dir = gitFixture();
    fs.writeFileSync(path.join(dir, "note.txt"), "one\n");
    await stageFiles(dir, ["note.txt"]);
    await commitChanges(dir, "Initial commit");
    const remote = fs.mkdtempSync(
      path.join(os.tmpdir(), "nexus-git-pull-remote-"),
    );
    created.push(remote);
    execFileSync("git", ["init", "-q", "--bare", remote], { stdio: "ignore" });
    execFileSync("git", ["remote", "add", "origin", remote], {
      cwd: dir,
      stdio: "ignore",
    });
    await pushCommits(dir);
    fs.writeFileSync(path.join(dir, "note.txt"), "local edit\n");
    await expect(pullFastForward(dir)).rejects.toThrow(
      "working tree has changes",
    );
  },
);

test.skipIf(!gitAvailable)(
  "pullFastForward updates a clean branch",
  async () => {
    const dir = gitFixture();
    fs.writeFileSync(path.join(dir, "note.txt"), "one\n");
    await stageFiles(dir, ["note.txt"]);
    await commitChanges(dir, "Initial commit");
    const remote = fs.mkdtempSync(
      path.join(os.tmpdir(), "nexus-git-pull-success-"),
    );
    created.push(remote);
    execFileSync("git", ["init", "-q", "--bare", remote], { stdio: "ignore" });
    execFileSync("git", ["remote", "add", "origin", remote], {
      cwd: dir,
      stdio: "ignore",
    });
    await pushCommits(dir);

    const peer = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-git-pull-peer-"));
    created.push(peer);
    execFileSync("git", ["clone", "-q", remote, peer], { stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "nexus@example.test"], {
      cwd: peer,
    });
    execFileSync("git", ["config", "user.name", "Nexus Test"], { cwd: peer });
    fs.writeFileSync(path.join(peer, "remote.txt"), "from remote\n");
    execFileSync("git", ["add", "remote.txt"], { cwd: peer });
    execFileSync("git", ["commit", "-m", "Remote change"], { cwd: peer });
    execFileSync("git", ["push", "-q"], { cwd: peer });

    const sync = await pullFastForward(dir);
    expect(sync.behind).toBe(0);
    expect(fs.readFileSync(path.join(dir, "remote.txt"), "utf8")).toBe(
      "from remote\n",
    );
  },
);

test.skipIf(!gitAvailable)(
  "createTag validates and lists local tags",
  async () => {
    const dir = gitFixture();
    fs.writeFileSync(path.join(dir, "note.txt"), "one\n");
    await stageFiles(dir, ["note.txt"]);
    await commitChanges(dir, "Initial commit");
    await createTag(dir, "v0.1.0");
    expect(await listTags(dir)).toEqual(["v0.1.0"]);
    await expect(createTag(dir, "bad tag")).rejects.toThrow(
      "A valid tag name is required.",
    );
  },
);

test.skipIf(!gitAvailable)(
  "revertCommit creates an inverse commit safely",
  async () => {
    const dir = gitFixture();
    fs.writeFileSync(path.join(dir, "note.txt"), "one\n");
    await stageFiles(dir, ["note.txt"]);
    await commitChanges(dir, "Initial commit");
    fs.writeFileSync(path.join(dir, "note.txt"), "two\n");
    await stageFiles(dir, ["note.txt"]);
    await commitChanges(dir, "Change note");
    const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir })
      .toString("utf8")
      .trim();
    await revertCommit(dir, revision);
    expect(fs.readFileSync(path.join(dir, "note.txt"), "utf8")).toBe("one\n");
    fs.writeFileSync(path.join(dir, "note.txt"), "dirty\n");
    await expect(revertCommit(dir, revision)).rejects.toThrow(
      "working tree has changes",
    );
  },
);

test.skipIf(!gitAvailable)(
  "stashChanges saves and applyLatestStash restores changes",
  async () => {
    const dir = gitFixture();
    fs.writeFileSync(path.join(dir, "note.txt"), "one\n");
    await stageFiles(dir, ["note.txt"]);
    await commitChanges(dir, "Initial commit");
    fs.writeFileSync(path.join(dir, "note.txt"), "changed\n");
    fs.writeFileSync(path.join(dir, "untracked.txt"), "new\n");

    await stashChanges(dir, "Nexus test");
    expect(fs.readFileSync(path.join(dir, "note.txt"), "utf8")).toBe("one\n");
    expect(fs.existsSync(path.join(dir, "untracked.txt"))).toBe(false);
    await applyLatestStash(dir);
    expect(fs.readFileSync(path.join(dir, "note.txt"), "utf8")).toBe(
      "changed\n",
    );
    expect(fs.readFileSync(path.join(dir, "untracked.txt"), "utf8")).toBe(
      "new\n",
    );
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
