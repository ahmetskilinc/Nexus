import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  augment,
  loadInstructionFile,
  loadInstructionFileInfo,
} from "./instructions";

const dirs: string[] = [];
function tempdir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "nexus-instr-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("instructions", () => {
  test("load returns undefined without a file", () => {
    expect(loadInstructionFile(tempdir())).toBeUndefined();
  });

  test("AGENTS.md wins over CLAUDE.md", () => {
    const dir = tempdir();
    writeFileSync(path.join(dir, "CLAUDE.md"), "claude rules");
    writeFileSync(path.join(dir, "AGENTS.md"), "agents rules");
    expect(loadInstructionFile(dir)).toBe("agents rules");
    expect(loadInstructionFileInfo(dir)?.source).toBe("AGENTS.md");
  });

  test(".nexus.md wins over CLAUDE.md", () => {
    const dir = tempdir();
    writeFileSync(path.join(dir, "CLAUDE.md"), "claude rules");
    writeFileSync(path.join(dir, ".nexus.md"), "nexus rules");
    expect(loadInstructionFile(dir)).toBe("nexus rules");
  });

  test("matches case-insensitively", () => {
    const dir = tempdir();
    writeFileSync(path.join(dir, "agents.md"), "lowercase name");
    expect(loadInstructionFile(dir)).toBe("lowercase name");
  });

  test("empty file is ignored", () => {
    const dir = tempdir();
    writeFileSync(path.join(dir, "AGENTS.md"), "   \n\t");
    expect(loadInstructionFile(dir)).toBeUndefined();
  });

  test("oversized file is capped on a character boundary", () => {
    const dir = tempdir();
    // 2 bytes per é — well over the 8 KiB cap.
    writeFileSync(path.join(dir, "AGENTS.md"), "é".repeat(8 * 1024));
    const loaded = loadInstructionFile(dir);
    if (!loaded) throw new Error("expected content");
    expect(Buffer.byteLength(loaded)).toBeLessThanOrEqual(8 * 1024);
    expect([...loaded].every((character) => character === "é")).toBe(true);
    expect(loadInstructionFileInfo(dir)?.truncated).toBe(true);
  });

  test("augment appends file and override under one header", () => {
    const result = augment("BASE", "file text", "override text");
    expect(result.startsWith("BASE\n\n# Workspace instructions\n\n")).toBe(
      true,
    );
    expect(result).toContain("file text");
    expect(result).toContain("override text");
    expect(result.indexOf("file text")).toBeLessThan(
      result.indexOf("override text"),
    );
  });

  test("augment without supplements returns base", () => {
    expect(augment("BASE", undefined, undefined)).toBe("BASE");
    expect(augment("BASE", "  ", "\n")).toBe("BASE");
  });

  test("augment with only the override", () => {
    expect(augment("BASE", undefined, "just the override")).toBe(
      "BASE\n\n# Workspace instructions\n\njust the override",
    );
  });
});
