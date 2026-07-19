/// Per-workspace memory: durable facts the agent records with `memory_save`
/// and recalls at the top of each run. Each workspace gets a JSONL file in the
/// app's data dir — keyed by a hash of the (canonical) workspace path, so it
/// lives outside the repo and never lands in a diff. The store is capped so
/// it can't grow without bound; the oldest entries drop first.

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { type Memory, RuntimeError } from "@nexus/protocol";
import {
  canonicalWorkspacePath,
  defaultDataDir,
  type StoreOptions,
  sha256Hex,
} from "./checkpoint/store";

/// Largest number of memories kept per workspace; older entries are dropped.
const MAX_ENTRIES = 200;

export type MemoryOptions = StoreOptions;

/// The JSONL store path for a workspace, or null when no data dir is found.
/// The filename is the hex SHA-256 of the canonical workspace path, so
/// different repos never share a memory file and the path itself isn't
/// exposed on disk.
export function memoryStorePath(
  workspace: string,
  options?: MemoryOptions,
): string | null {
  const base = options?.dataDir ?? defaultDataDir();
  if (!base) return null;
  return path.join(
    base,
    "dev.nexus.app",
    "memory",
    `${sha256Hex(canonicalWorkspacePath(workspace))}.jsonl`,
  );
}

/// Reads and parses a JSONL store, skipping any malformed lines. A missing
/// file is an empty store.
export function readStore(storePath: string): Memory[] {
  let text: string;
  try {
    text = fs.readFileSync(storePath, "utf8");
  } catch {
    return [];
  }
  const entries: Memory[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.id !== "string" ||
      typeof record.fact !== "string" ||
      typeof record.createdAt !== "number"
    ) {
      continue;
    }
    entries.push({
      id: record.id,
      fact: record.fact,
      createdAt: record.createdAt,
    });
  }
  return entries;
}

/// Writes the store as JSONL, creating the parent directory as needed.
export function writeStore(storePath: string, entries: Memory[]): void {
  try {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
  } catch (error) {
    throw RuntimeError.msg(`Could not create memory store: ${message(error)}`);
  }
  let body = "";
  for (const entry of entries) {
    body += `${JSON.stringify({
      id: entry.id,
      fact: entry.fact,
      createdAt: entry.createdAt,
    })}\n`;
  }
  try {
    fs.writeFileSync(storePath, body);
  } catch (error) {
    throw RuntimeError.msg(`Could not write memory store: ${message(error)}`);
  }
}

/// Keeps only the most recent `max` entries (the oldest drop first).
export function capEntries(entries: Memory[], max: number): Memory[] {
  if (entries.length > max) {
    return entries.slice(entries.length - max);
  }
  return entries;
}

/// Lists the memories for a workspace, oldest first.
export async function listMemories(
  workspace: string,
  options?: MemoryOptions,
): Promise<Memory[]> {
  const store = memoryStorePath(workspace, options);
  return store ? readStore(store) : [];
}

/// Saves a new fact and returns it. Blank facts are rejected. The store is
/// capped after the append, so the oldest entries drop once it is full.
export async function saveMemory(
  workspace: string,
  fact: string,
  options?: MemoryOptions,
): Promise<Memory> {
  const trimmed = fact.trim();
  if (trimmed === "") {
    throw RuntimeError.msg("A memory can't be empty.");
  }
  const store = memoryStorePath(workspace, options);
  if (!store) {
    throw RuntimeError.msg("No data directory is available.");
  }
  const memory: Memory = {
    id: randomUUID(),
    fact: trimmed,
    createdAt: Date.now(),
  };
  const entries = capEntries([...readStore(store), memory], MAX_ENTRIES);
  writeStore(store, entries);
  return memory;
}

/// Deletes the memory with `id`, if present. Missing ids are a no-op.
export async function deleteMemory(
  workspace: string,
  id: string,
  options?: MemoryOptions,
): Promise<void> {
  const store = memoryStorePath(workspace, options);
  if (!store) return;
  const entries = readStore(store).filter((memory) => memory.id !== id);
  writeStore(store, entries);
}

/// Clears every memory for the workspace by removing the store file.
export async function clearMemories(
  workspace: string,
  options?: MemoryOptions,
): Promise<void> {
  const store = memoryStorePath(workspace, options);
  if (!store) return;
  try {
    fs.unlinkSync(store);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw RuntimeError.msg(`Could not clear memory store: ${message(error)}`);
  }
}

/// The system-prompt block recalling a workspace's memories, or null when
/// there are none.
export function promptBlock(memories: Memory[]): string | null {
  if (memories.length === 0) return null;
  const lines = memories.map((memory) => `- ${memory.fact}`);
  return `What you remember about this workspace (saved via memory_save on earlier runs):\n${lines.join("\n")}`;
}

export async function memoryPromptBlock(
  workspace: string,
  options?: MemoryOptions,
): Promise<string | null> {
  return promptBlock(await listMemories(workspace, options));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
