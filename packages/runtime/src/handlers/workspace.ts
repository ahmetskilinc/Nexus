import { loadInstructionFileInfo } from "@nexus/agent";
import { asRecord, RuntimeError } from "@nexus/protocol";
import {
  commitChanges,
  discardFile,
  indexWorkspace,
  inspectWorkspace,
  listMemories,
  restoreCheckpoint,
  stageFiles,
  unstageFiles,
  workspaceChanges,
  workspaceDiff,
} from "@nexus/workspace";
import { stringArrayParam, stringParam } from "../params";

export async function handleWorkspaceIndex(params: unknown) {
  const path = stringParam(params, "path");
  return { files: await indexWorkspace(path) };
}

export async function handleWorkspaceInspect(params: unknown) {
  const path = stringParam(params, "path");
  const report = await inspectWorkspace(path);
  return {
    workspaceSummary: report.workspaceSummary,
    gitSummary: report.gitSummary,
  };
}

export async function handleWorkspaceChanges(params: unknown) {
  const path = stringParam(params, "path");
  return { changes: await workspaceChanges(path) };
}

export async function handleWorkspaceDiff(params: unknown) {
  const path = stringParam(params, "path");
  const relativePath = stringParam(params, "relativePath");
  return { patch: await workspaceDiff(path, relativePath) };
}

export async function handleWorkspaceStage(params: unknown) {
  const path = stringParam(params, "path");
  await stageFiles(path, stringArrayParam(params, "paths"));
  return {};
}

export async function handleWorkspaceUnstage(params: unknown) {
  const path = stringParam(params, "path");
  await unstageFiles(path, stringArrayParam(params, "paths"));
  return {};
}

export async function handleWorkspaceCommit(params: unknown) {
  const path = stringParam(params, "path");
  const message = stringParam(params, "message");
  await commitChanges(path, message);
  return {};
}

export async function handleWorkspaceDiscard(params: unknown) {
  const path = stringParam(params, "path");
  const relativePath = stringParam(params, "relativePath");
  await discardFile(path, relativePath);
  return {};
}

export async function handleCheckpointRestore(params: unknown) {
  const path = stringParam(params, "path");
  const checkpointId = stringParam(params, "checkpointId");
  // Optional subset of the checkpoint's files; absent restores all.
  const raw = asRecord(params)?.paths;
  let paths: string[] | null = null;
  if (raw !== undefined && raw !== null) {
    if (!Array.isArray(raw) || !raw.every((item) => typeof item === "string"))
      throw RuntimeError.msg('The "paths" parameter is malformed.');
    paths = raw;
  }
  return { files: await restoreCheckpoint(path, checkpointId, paths) };
}

export async function handleContextPreview(params: unknown) {
  const path = stringParam(params, "path");
  const loaded = loadInstructionFileInfo(path);
  const memories = await listMemories(path);
  return {
    instructionSource: loaded?.source ?? null,
    instructionText: loaded?.text ?? null,
    instructionTruncated: loaded?.truncated ?? false,
    memories,
  };
}
