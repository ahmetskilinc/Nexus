/// git_status and git_diff: read-only git subprocess tools.

import { spawn } from "node:child_process";
import { asBoolean, asString, ToolError } from "@nexus/protocol";
import { pathComponents } from "./path";
import { errorMessage } from "./util";

interface GitResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runGit(workspace: string, args: string[]): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: workspace,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

export async function gitStatusTool(workspace: string): Promise<string> {
  let result: GitResult;
  try {
    result = await runGit(workspace, ["status", "--short", "--branch"]);
  } catch (error) {
    return `Git is unavailable: ${errorMessage(error)}`;
  }
  const stdout = result.stdout.trim();
  if (result.code === 0) {
    return stdout === "" ? "Working tree is clean." : stdout;
  }
  const stderr = result.stderr.trim();
  return stderr === "" ? "This workspace is not a Git repository." : stderr;
}

export async function gitDiffTool(
  workspace: string,
  args: Record<string, unknown>,
): Promise<string> {
  const gitArgs = ["diff", "--no-ext-diff", "--no-color"];
  if (asBoolean(args.staged) ?? false) gitArgs.push("--cached");
  const path = asString(args.path);
  if (path !== undefined && path !== "") {
    // Reject paths that escape the workspace before handing them to git.
    for (const component of pathComponents(path)) {
      if (component.kind !== "normal" && component.kind !== "current") {
        throw new ToolError("the path resolves outside the workspace.");
      }
    }
    gitArgs.push("--", path);
  }
  let result: GitResult;
  try {
    result = await runGit(workspace, gitArgs);
  } catch (error) {
    throw new ToolError(`git is unavailable: ${errorMessage(error)}`);
  }
  if (result.code === 0) {
    return result.stdout.trim() === "" ? "No changes." : result.stdout;
  }
  const stderr = result.stderr.trim();
  if (stderr === "") return "This workspace is not a Git repository.";
  throw new ToolError(stderr);
}
