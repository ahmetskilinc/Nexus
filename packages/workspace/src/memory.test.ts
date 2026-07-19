import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Memory } from "@nexus/protocol";
import {
  capEntries,
  clearMemories,
  deleteMemory,
  listMemories,
  memoryPromptBlock,
  promptBlock,
  readStore,
  saveMemory,
  writeStore,
} from "./memory";

const created: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function memory(id: string, fact: string): Memory {
  return { id, fact, createdAt: 0 };
}

test("store round trips through disk", () => {
  const store = path.join(tempDir("nexus-mem-"), "store.jsonl");
  expect(readStore(store)).toEqual([]);
  const entries = [memory("1", "uses bun"), memory("2", "tabs not spaces")];
  writeStore(store, entries);
  expect(readStore(store)).toEqual(entries);
});

test("read store skips malformed lines", () => {
  const store = path.join(tempDir("nexus-mem-"), "store.jsonl");
  fs.writeFileSync(store, '{"id":"1","fact":"ok","createdAt":0}\nnot json\n\n');
  const entries = readStore(store);
  expect(entries.length).toBe(1);
  expect(entries[0].fact).toBe("ok");
});

test("cap drops the oldest over the limit", () => {
  const entries: Memory[] = Array.from({ length: 10 }, (_, index) =>
    memory(String(index), `fact ${index}`),
  );
  const capped = capEntries(entries, 3);
  expect(capped.length).toBe(3);
  // The three most recent survive; the oldest seven are gone.
  expect(capped[0].id).toBe("7");
  expect(capped[2].id).toBe("9");
});

test("cap leaves under-limit untouched", () => {
  const entries = [memory("1", "a"), memory("2", "b")];
  expect(capEntries(entries, 5)).toEqual(entries);
});

test("prompt block lists facts or is none", () => {
  expect(promptBlock([])).toBeNull();
  const block = promptBlock([
    memory("1", "uses bun"),
    memory("2", "prefers tabs"),
  ]);
  expect(block).toContain("What you remember about this workspace");
  expect(block).toContain("- uses bun");
  expect(block).toContain("- prefers tabs");
});

test("memories are keyed by the hashed canonical workspace path", async () => {
  const workspace = tempDir("nexus-mem-ws-");
  const options = { dataDir: tempDir("nexus-mem-data-") };

  const saved = await saveMemory(workspace, "  uses bun  ", options);
  expect(saved.fact).toBe("uses bun");
  expect(saved.createdAt).toBeGreaterThan(0);

  const key = createHash("sha256")
    .update(fs.realpathSync(workspace), "utf8")
    .digest("hex");
  const store = path.join(
    options.dataDir,
    "dev.nexus.app",
    "memory",
    `${key}.jsonl`,
  );
  expect(fs.existsSync(store)).toBe(true);
  expect(await listMemories(workspace, options)).toEqual([saved]);
  expect(await memoryPromptBlock(workspace, options)).toBe(
    "What you remember about this workspace (saved via memory_save on earlier runs):\n- uses bun",
  );

  await deleteMemory(workspace, saved.id, options);
  expect(await listMemories(workspace, options)).toEqual([]);
});

test("save rejects blank facts and caps the store at the limit", async () => {
  const workspace = tempDir("nexus-mem-cap-ws-");
  const options = { dataDir: tempDir("nexus-mem-cap-data-") };

  expect(saveMemory(workspace, "   ", options)).rejects.toThrow(
    "A memory can't be empty.",
  );

  const store = path.join(
    options.dataDir,
    "dev.nexus.app",
    "memory",
    `${createHash("sha256").update(fs.realpathSync(workspace), "utf8").digest("hex")}.jsonl`,
  );
  // Pre-fill to the cap, then one more save must drop the oldest.
  const full: Memory[] = Array.from({ length: 200 }, (_, index) =>
    memory(String(index), `fact ${index}`),
  );
  writeStore(store, full);
  await saveMemory(workspace, "the newest fact", options);
  const entries = await listMemories(workspace, options);
  expect(entries.length).toBe(200);
  expect(entries[0].fact).toBe("fact 1");
  expect(entries[199].fact).toBe("the newest fact");

  await clearMemories(workspace, options);
  expect(fs.existsSync(store)).toBe(false);
  expect(await listMemories(workspace, options)).toEqual([]);
  // Clearing an already-missing store is a no-op.
  await clearMemories(workspace, options);
});
