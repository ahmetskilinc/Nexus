import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { cleanup, temporaryPath } from "./testutil";
import { Toolbox } from "./toolbox";

function gitFixture(): { dir: string; toolbox: Toolbox } {
  const dir = temporaryPath("nexus-git-test");
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "nexus@example.test");
  git("config", "user.name", "Nexus Test");
  fs.writeFileSync(path.join(dir, "note.txt"), "one\n");
  git("add", "note.txt");
  git("commit", "-q", "-m", "Add note");
  return { dir, toolbox: new Toolbox(dir) };
}

describe("git_status", () => {
  test("reports a clean tree and untracked files", async () => {
    const { dir, toolbox } = gitFixture();
    let output = await toolbox.execute("git_status", {});
    expect(output).toContain("##");
    expect(output).not.toContain("note.txt");

    fs.writeFileSync(path.join(dir, "new.txt"), "x\n");
    output = await toolbox.execute("git_status", {});
    expect(output).toContain("?? new.txt");
    cleanup(dir);
  });
});

describe("git_diff", () => {
  test("shows working-tree and staged changes", async () => {
    const { dir, toolbox } = gitFixture();
    expect(await toolbox.execute("git_diff", {})).toBe("No changes.");

    fs.writeFileSync(path.join(dir, "note.txt"), "two\n");
    const diff = await toolbox.execute("git_diff", {});
    expect(diff).toContain("-one");
    expect(diff).toContain("+two");

    execFileSync("git", ["add", "note.txt"], { cwd: dir, stdio: "ignore" });
    const staged = await toolbox.execute("git_diff", { staged: true });
    expect(staged).toContain("+two");
    expect(await toolbox.execute("git_diff", {})).toBe("No changes.");
    cleanup(dir);
  });

  test("rejects paths that escape the workspace", async () => {
    const { dir, toolbox } = gitFixture();
    await expect(
      toolbox.execute("git_diff", { path: "../outside.rs" }),
    ).rejects.toThrow("the path resolves outside the workspace.");
    await expect(
      toolbox.execute("git_diff", { path: "/etc/passwd" }),
    ).rejects.toThrow("the path resolves outside the workspace.");
    cleanup(dir);
  });
});
