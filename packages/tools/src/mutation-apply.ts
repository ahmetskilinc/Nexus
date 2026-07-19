/// Applies a previously planned (and approved) mutation, re-validating the
/// TOCTOU window between plan and write.

import * as fs from "node:fs";
import * as path from "node:path";
import { ToolError } from "@nexus/protocol";
import { type MutationPlan, readText } from "./mutation-plan";
import { verifyWriteTarget } from "./path";
import { errorMessage } from "./util";

const CHANGED_ON_DISK =
  "The file changed on disk after this mutation was planned; plan it again.";

/// Re-verifies that the filesystem still matches the plan's before image.
/// The Rust runtime only re-verified the write target's containment; the TS
/// port additionally rejects a target (or rename source) whose existence or
/// content diverged between plan/approval and apply.
function verifyBeforeImage(plan: MutationPlan): void {
  if (plan.source !== null) {
    // A rename: the source must be intact and the destination still free.
    if (!fs.existsSync(plan.source) || readText(plan.source) !== plan.before) {
      throw new ToolError(CHANGED_ON_DISK);
    }
    if (fs.existsSync(plan.target)) throw new ToolError(CHANGED_ON_DISK);
    return;
  }
  const exists = fs.existsSync(plan.target);
  if (exists !== plan.beforeExists) throw new ToolError(CHANGED_ON_DISK);
  if (exists && readText(plan.target) !== plan.before) {
    throw new ToolError(CHANGED_ON_DISK);
  }
}

/// Writes (or deletes) the target of a previously planned mutation.
export async function applyMutation(
  workspace: string,
  plan: MutationPlan,
): Promise<string> {
  // Re-verify containment now, not just at plan time: a component could
  // have been swapped for a symlink between planning/approval and here.
  verifyWriteTarget(workspace, plan.target);
  verifyBeforeImage(plan);
  try {
    if (plan.source !== null) {
      fs.mkdirSync(path.dirname(plan.target), { recursive: true });
      fs.renameSync(plan.source, plan.target);
      return plan.message;
    }
    if (plan.after !== null) {
      fs.mkdirSync(path.dirname(plan.target), { recursive: true });
      fs.writeFileSync(plan.target, plan.after);
      return plan.message;
    }
    fs.unlinkSync(plan.target);
    return plan.message;
  } catch (error) {
    throw new ToolError(errorMessage(error));
  }
}
