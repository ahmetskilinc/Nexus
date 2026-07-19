import { clearMemories, deleteMemory, listMemories } from "@nexus/workspace";
import { stringParam } from "../params";

export async function handleMemoryList(params: unknown) {
  const path = stringParam(params, "path");
  return { memories: await listMemories(path) };
}

export async function handleMemoryDelete(params: unknown) {
  const path = stringParam(params, "path");
  const id = stringParam(params, "id");
  await deleteMemory(path, id);
  return {};
}

export async function handleMemoryClear(params: unknown) {
  const path = stringParam(params, "path");
  await clearMemories(path);
  return {};
}
