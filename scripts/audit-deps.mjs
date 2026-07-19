// Supply-chain advisory check for the npm dependency tree via `bun audit`.
//
// This is an advisory lookup against a remote database, so a network failure
// must not fail `bun run check` — that would make the whole check script
// unrunnable offline. Only an actual reported vulnerability is a failure;
// everything else warns and moves on.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

/// True if the auditor can actually run.
function available(file, probeArgs) {
  try {
    execFileSync(file, probeArgs, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/// Runs one auditor. Returns true if it reported vulnerabilities, false if it
/// was clean, and null if it could not run at all (not installed, offline).
function audit(label, file, args, cwd, probeArgs) {
  if (!available(file, probeArgs)) {
    console.warn(`audit-deps: ${label} unavailable — skipped.`);
    return null;
  }
  try {
    execFileSync(file, args, { cwd, stdio: "inherit" });
    console.log(`audit-deps: ${label} clean.`);
    return false;
  } catch (error) {
    console.error(
      `audit-deps: ${label} reported findings (exit ${error.status}).`,
    );
    return true;
  }
}

const results = [audit("bun audit", "bun", ["audit"], repoRoot, ["--version"])];

if (results.some((found) => found === true)) process.exit(1);
if (results.includes(null))
  console.warn("audit-deps: the auditor was skipped (offline?).");
