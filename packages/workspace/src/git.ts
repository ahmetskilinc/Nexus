import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { RuntimeError } from "@nexus/protocol";

export type GitResult = {
  success: boolean;
  code: number | null;
  stdout: Buffer;
  stderr: Buffer;
};

/// Runs git without a shell and resolves with the exit status like Rust's
/// `Command::output` — a nonzero exit is a result, not a rejection. Only a
/// spawn failure (git missing) rejects, as a RuntimeError.
export function runGit(workspace: string, args: string[]): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd: workspace, encoding: "buffer", maxBuffer: 512 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const failure = error as
          | (Error & { code?: number | string; signal?: string | null })
          | null;
        if (failure && typeof failure.code !== "number") {
          // String code (ENOENT, EACCES…) means the process never ran; a
          // signal means it died abnormally — both are non-exits.
          if (failure.signal == null) {
            reject(RuntimeError.msg(failure.message));
            return;
          }
          resolve({ success: false, code: null, stdout, stderr });
          return;
        }
        const code = failure ? (failure.code as number) : 0;
        resolve({ success: code === 0, code, stdout, stderr });
      },
    );
  });
}

/// One-line-per-change summary used by inspect(); never throws.
export async function gitStatusSummary(workspace: string): Promise<string> {
  let output: GitResult;
  try {
    output = await runGit(workspace, ["status", "--short", "--branch"]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return `Git is unavailable: ${detail}`;
  }
  const stdout = output.stdout.toString("utf8").trim();
  if (output.success) {
    return stdout === "" ? "Working tree is clean." : stdout;
  }
  const stderr = output.stderr.toString("utf8").trim();
  return stderr === "" ? "This workspace is not a Git repository." : stderr;
}

async function gitAction(
  workspace: string,
  args: string[],
  failure: string,
): Promise<void> {
  const output = await runGit(workspace, args);
  if (output.success) return;
  const detail = output.stderr.toString("utf8").trim();
  throw RuntimeError.msg(detail === "" ? failure : detail);
}

export async function stageFiles(
  workspace: string,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) {
    throw RuntimeError.msg("Select at least one file to stage.");
  }
  for (const p of paths) validateRelativePath(p);
  await gitAction(
    workspace,
    ["add", "--", ...paths],
    "Git could not stage the selected files.",
  );
}

export async function unstageFiles(
  workspace: string,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) {
    throw RuntimeError.msg("Select at least one file to unstage.");
  }
  for (const p of paths) validateRelativePath(p);
  await gitAction(
    workspace,
    ["reset", "--quiet", "HEAD", "--", ...paths],
    "Git could not unstage the selected files.",
  );
}

export async function commitChanges(
  workspace: string,
  message: string,
): Promise<void> {
  const trimmed = message.trim();
  if (trimmed === "") {
    throw RuntimeError.msg("A commit message is required.");
  }
  await gitAction(
    workspace,
    ["commit", "-m", trimmed],
    "Git could not create the commit.",
  );
}

export async function discardFile(
  workspace: string,
  relativePath: string,
): Promise<void> {
  validateRelativePath(relativePath);
  const tracked = (
    await runGit(workspace, ["ls-files", "--error-unmatch", "--", relativePath])
  ).success;
  if (tracked) {
    await gitAction(
      workspace,
      [
        "restore",
        "--staged",
        "--worktree",
        "--source=HEAD",
        "--",
        relativePath,
      ],
      "Git could not discard the selected file's changes.",
    );
    return;
  }

  const target = path.join(workspace, relativePath);
  if (!isFile(target)) {
    throw RuntimeError.msg(
      "Only untracked files can be discarded; directories are not removed.",
    );
  }
  fs.unlinkSync(target);
}

export async function workspaceDiff(
  workspace: string,
  relativePath: string,
): Promise<string> {
  validateRelativePath(relativePath);
  const output = await runGit(workspace, [
    "diff",
    "--no-ext-diff",
    "--no-color",
    "HEAD",
    "--",
    relativePath,
  ]);
  if (!output.success) {
    const detail = output.stderr.toString("utf8").trim();
    throw RuntimeError.msg(
      detail === "" ? "Git could not produce a diff for this file." : detail,
    );
  }
  const patch = output.stdout.toString("utf8");
  if (patch !== "" || !isFile(path.join(workspace, relativePath))) {
    return patch;
  }

  // `git diff HEAD` is empty for an untracked file. Render it against
  // /dev/null so the review panel can still show its contents before staging.
  const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";
  const untracked = await runGit(workspace, [
    "diff",
    "--no-index",
    "--no-ext-diff",
    "--no-color",
    "--",
    nullDevice,
    relativePath,
  ]);
  // `git diff --no-index` returns 1 when files differ, which is success here.
  if (untracked.code === 0 || untracked.code === 1) {
    return untracked.stdout.toString("utf8");
  }
  return "";
}

/// Rejects empty, absolute, and `..`-escaping paths — the same components
/// Rust's `Path::components` classifies as anything but Normal/CurDir.
export function validateRelativePath(relativePath: string): void {
  if (relativePath === "") {
    throw RuntimeError.msg("A workspace-relative file path is required.");
  }
  if (!isWorkspaceRelative(relativePath)) {
    throw RuntimeError.msg("The requested file is outside the workspace.");
  }
}

export function isWorkspaceRelative(relativePath: string): boolean {
  if (path.isAbsolute(relativePath)) return false;
  // Windows drive-relative paths ("C:foo") are prefix components in Rust.
  if (process.platform === "win32" && /^[A-Za-z]:/.test(relativePath)) {
    return false;
  }
  const separators = process.platform === "win32" ? /[\\/]/ : /\//;
  return relativePath
    .split(separators)
    .every((component) => component !== "..");
}

function isFile(target: string): boolean {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}
