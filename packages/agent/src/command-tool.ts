import type { RuntimeEmitter } from "@nexus/protocol";
import { asRecord, asString } from "@nexus/protocol";
import {
  COMMAND_TIMEOUT_MS,
  type CommandEnvironment,
  isDeniedCommand,
  runCommand,
} from "@nexus/tools";
import type { ApprovalMailbox } from "./approvals";
import { type ApprovalMode, requiresApproval } from "./modes";

/// Parses `command` from a run_command call, runs it (gated by approval in
/// Ask mode), and returns the model-facing result: a status line (exit code
/// or timeout) followed by the captured output, so the verification loop can
/// read pass/fail unambiguously. Output streams to the UI live via
/// `command_output`; a terminal `command_end` carries the exit status.
export async function runCommandTool(options: {
  workspace: string;
  emitter: RuntimeEmitter;
  mode: ApprovalMode;
  commandEnvironment: CommandEnvironment;
  mailbox: ApprovalMailbox;
  callId: string;
  argumentsJson: string;
  signal: AbortSignal;
  timeoutMs?: number;
}): Promise<string> {
  const { emitter, mailbox, callId } = options;
  let parsed: unknown;
  try {
    parsed = JSON.parse(options.argumentsJson);
  } catch {
    parsed = {};
  }
  const command = (asString(asRecord(parsed)?.command) ?? "").trim();
  if (command.length === 0) return 'Error: "command" is required.';
  if (isDeniedCommand(command))
    return "Error: this command is blocked as potentially destructive and was not run.";

  let approved = true;
  if (requiresApproval(options.mode)) {
    emitter.emit({
      type: "approval_request",
      kind: "command",
      callId,
      tool: "run_command",
      command,
    });
    approved = await mailbox.wait(callId, options.signal);
  }
  if (!approved) return "The user declined to run this command.";

  const timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS;
  const outcome = await runCommand({
    workspace: options.workspace,
    command,
    environment: options.commandEnvironment,
    callId,
    emitter,
    signal: options.signal,
    timeoutMs,
  });
  emitter.emit({
    type: "command_end",
    callId,
    exitCode: outcome.exitCode,
    timedOut: outcome.timedOut,
  });

  const status = outcome.timedOut
    ? `The command timed out after ${Math.floor(timeoutMs / 1000)}s and was terminated.`
    : outcome.exitCode !== null
      ? `Exit code: ${outcome.exitCode}`
      : "The command was terminated before it exited.";
  return outcome.output.trim().length === 0
    ? `${status}\n\n(no output)`
    : `${status}\n\n${outcome.output}`;
}
