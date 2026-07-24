import { loadInstructionFileInfo } from "@nexus/agent";
import { asRecord, RuntimeError } from "@nexus/protocol";
import {
  applyLatestStash,
  branchSync,
  commitChanges,
  createBranch,
  createTag,
  deleteBranch,
  discardFile,
  fetchRemotes,
  indexWorkspace,
  inspectWorkspace,
  listMemories,
  listTags,
  projectMap,
  pullFastForward,
  pushCommits,
  renameBranch,
  revertCommit,
  restoreCheckpoint,
  restoreLatestMutation,
  searchWorkspaceText,
  stageFiles,
  stashChanges,
  switchBranch,
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

export async function handleWorkspaceProjectMap(params: unknown) {
  const path = stringParam(params, "path");
  return { map: await projectMap(path) };
}

export async function handleWorkspaceSearch(params: unknown) {
  const path = stringParam(params, "path");
  const query = stringParam(params, "query");
  return { matches: await searchWorkspaceText(path, query) };
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

export async function handleWorkspaceSwitchBranch(params: unknown) {
  const path = stringParam(params, "path");
  const name = stringParam(params, "name");
  await switchBranch(path, name);
  return {};
}

export async function handleWorkspaceCreateBranch(params: unknown) {
  const path = stringParam(params, "path");
  const name = stringParam(params, "name");
  await createBranch(path, name);
  return {};
}

export async function handleWorkspaceRenameBranch(params: unknown) {
  const path = stringParam(params, "path");
  const from = stringParam(params, "from");
  const to = stringParam(params, "to");
  await renameBranch(path, from, to);
  return {};
}

export async function handleWorkspaceDeleteBranch(params: unknown) {
  const path = stringParam(params, "path");
  const name = stringParam(params, "name");
  await deleteBranch(path, name);
  return {};
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

export async function handleWorkspaceSync(params: unknown) {
  const path = stringParam(params, "path");
  return { sync: await branchSync(path) };
}

export async function handleWorkspaceFetch(params: unknown) {
  const path = stringParam(params, "path");
  return { sync: await fetchRemotes(path) };
}

export async function handleWorkspacePull(params: unknown) {
  const path = stringParam(params, "path");
  return { sync: await pullFastForward(path) };
}

export async function handleWorkspacePush(params: unknown) {
  const path = stringParam(params, "path");
  return { sync: await pushCommits(path) };
}

export async function handleWorkspaceTags(params: unknown) {
  const path = stringParam(params, "path");
  return { tags: await listTags(path) };
}

export async function handleWorkspaceCreateTag(params: unknown) {
  const path = stringParam(params, "path");
  const name = stringParam(params, "name");
  const message = asRecord(params)?.message;
  await createTag(
    path,
    name,
    typeof message === "string" ? message : undefined,
  );
  return {};
}

export async function handleWorkspaceRevertCommit(params: unknown) {
  const path = stringParam(params, "path");
  const revision = stringParam(params, "revision");
  await revertCommit(path, revision);
  return {};
}

export async function handleWorkspaceStash(params: unknown) {
  const path = stringParam(params, "path");
  const message = asRecord(params)?.message;
  await stashChanges(path, typeof message === "string" ? message : undefined);
  return {};
}

export async function handleWorkspaceApplyStash(params: unknown) {
  const path = stringParam(params, "path");
  await applyLatestStash(path);
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

export async function handleCheckpointRestoreLatestMutation(params: unknown) {
  const path = stringParam(params, "path");
  const checkpointId = stringParam(params, "checkpointId");
  const relativePath = stringParam(params, "relativePath");
  await restoreLatestMutation(path, checkpointId, relativePath);
  return {};
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
