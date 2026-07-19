/// The shell tool: streamed, timeout-bounded command execution.

import { type ChildProcess, spawn } from "node:child_process";
import * as readline from "node:readline";
import type { RuntimeEmitter } from "@nexus/protocol";
import {
  type CommandEnvironment,
  restrictedEnvironment,
} from "./command-policy";
import { countCodePoints, OUTPUT_LIMIT } from "./util";

/// How long a `run_command` invocation may run before it is killed. Bounds
/// runaway/watch commands; the agent is told to avoid long-running commands.
export const COMMAND_TIMEOUT_MS = 120_000;

/// The result of a finished `run_command`. `output` is the capped combined
/// stdout/stderr text (no status prefix — the agent loop adds one).
/// `exitCode` is null when the process was killed (e.g. on timeout or abort)
/// or died on a signal.
export interface CommandOutcome {
  output: string;
  exitCode: number | null;
  timedOut: boolean;
}

export interface RunCommandOptions {
  workspace: string;
  command: string;
  environment: CommandEnvironment;
  callId: string;
  emitter: RuntimeEmitter;
  signal: AbortSignal;
  /// Injectable for tests; defaults to COMMAND_TIMEOUT_MS.
  timeoutMs?: number;
}

/// Runs a shell command in the workspace root, streaming each output line to
/// the UI via `command_output` events and returning the capped combined
/// output plus exit status. The command is non-interactive (stdin is null),
/// bounded by the timeout (killed on elapse), and killed when `signal`
/// aborts (cancellation) — in that case the promise still resolves, with the
/// partial output and a null exit code.
export function runCommand(
  options: RunCommandOptions,
): Promise<CommandOutcome> {
  const {
    workspace,
    command,
    environment,
    callId,
    emitter,
    signal,
    timeoutMs = COMMAND_TIMEOUT_MS,
  } = options;

  const child: ChildProcess =
    process.platform === "win32"
      ? spawn("cmd", ["/C", command], {
          cwd: workspace,
          stdio: ["ignore", "pipe", "pipe"],
          env:
            environment === "restricted"
              ? restrictedEnvironment()
              : process.env,
        })
      : spawn("sh", ["-c", command], {
          cwd: workspace,
          stdio: ["ignore", "pipe", "pipe"],
          env:
            environment === "restricted"
              ? restrictedEnvironment()
              : process.env,
        });

  let buffer = "";
  let used = 0;
  let truncated = false;
  // Set once the run is over (timeout or abort): the drain goes silent —
  // nothing more is appended or emitted — but the pipes keep being read so
  // the child never blocks on a full pipe before the kill lands.
  let done = false;

  /// Streams one output line to the UI and appends it to the capped
  /// model-facing buffer. Once the cap is hit it emits a single truncation
  /// marker and then goes silent, but the pipes keep draining.
  const streamLine = (stream: "stdout" | "stderr", line: string) => {
    if (done || truncated) return;
    const addition = countCodePoints(line) + 1;
    if (used + addition > OUTPUT_LIMIT) {
      truncated = true;
      emitter.emit({
        type: "command_output",
        callId,
        stream: "stderr",
        chunk: `[output truncated at ${OUTPUT_LIMIT} characters]`,
      });
      return;
    }
    emitter.emit({ type: "command_output", callId, stream, chunk: line });
    buffer += `${line}\n`;
    used += addition;
  };

  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let spawnFailed: Error | null = null;

    const timer = setTimeout(() => {
      timedOut = true;
      done = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const onAbort = () => {
      done = true;
      child.kill("SIGKILL");
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();

    const finish = (outcome: CommandOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(outcome);
    };

    if (child.stdout) {
      readline
        .createInterface({ input: child.stdout })
        .on("line", (line) => streamLine("stdout", line));
    }
    if (child.stderr) {
      readline
        .createInterface({ input: child.stderr })
        .on("line", (line) => streamLine("stderr", line));
    }

    child.on("error", (error) => {
      spawnFailed = error;
      // A spawn failure may not be followed by "close"; resolve directly.
      if (child.pid === undefined) {
        finish({
          output: `Error: failed to start command: ${error.message}`,
          exitCode: null,
          timedOut: false,
        });
      }
    });

    child.on("close", (code) => {
      if (spawnFailed !== null) {
        finish({
          output: `Error: failed to start command: ${spawnFailed.message}`,
          exitCode: null,
          timedOut: false,
        });
        return;
      }
      if (truncated) {
        buffer += `\n[Output truncated at ${OUTPUT_LIMIT} characters]`;
      }
      finish({ output: buffer, exitCode: timedOut ? null : code, timedOut });
    });
  });
}
