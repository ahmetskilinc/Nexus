import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { globToRegex } from "./search";
import { cleanup, fixture, temporaryPath } from "./testutil";
import { Toolbox } from "./toolbox";

describe("grep", () => {
  test("finds matches and respects scope", async () => {
    const { dir, toolbox } = fixture();
    const output = await toolbox.execute("grep", { pattern: "line t" });
    expect(output).toContain("src/lib.rs:2: line two");
    expect(output).toContain("src/lib.rs:3: line three");
    expect(
      await toolbox.execute("grep", { pattern: "alpha", path: "src" }),
    ).toBe("No matches.");
    cleanup(dir);
  });

  test("caps matches at 100", async () => {
    const dir = temporaryPath("nexus-grep-cap");
    fs.writeFileSync(path.join(dir, "big.txt"), "match\n".repeat(300));
    const toolbox = new Toolbox(dir);
    const output = await toolbox.execute("grep", { pattern: "match" });
    expect(output).toContain("[Stopped at 100 matches");
    expect(output.split("\n").length).toBe(101);
    cleanup(dir);
  });

  test("rejects an invalid regular expression", async () => {
    const { dir, toolbox } = fixture();
    await expect(toolbox.execute("grep", { pattern: "(" })).rejects.toThrow(
      "invalid regular expression.",
    );
    cleanup(dir);
  });
});

describe("glob", () => {
  test("matches by pattern and scope", async () => {
    const { dir, toolbox } = fixture();
    let output = await toolbox.execute("glob", { pattern: "**/*.rs" });
    expect(output).toContain("src/lib.rs");
    expect(output).not.toContain("notes.txt");

    output = await toolbox.execute("glob", { pattern: "*.txt" });
    expect(output).toContain("notes.txt");
    expect(output).not.toContain("src/lib.rs");

    output = await toolbox.execute("glob", { pattern: "*.rs", path: "src" });
    expect(output).toContain("src/lib.rs");

    expect(await toolbox.execute("glob", { pattern: "*.zig" })).toBe(
      "No matching files.",
    );
    cleanup(dir);
  });

  test("rejects an unterminated character class", async () => {
    const { dir, toolbox } = fixture();
    await expect(toolbox.execute("glob", { pattern: "[abc" })).rejects.toThrow(
      'unterminated "[" in glob pattern.',
    );
    cleanup(dir);
  });
});

describe("globToRegex", () => {
  test("handles wildcards", () => {
    expect(globToRegex("**/*.rs").test("a/b/c.rs")).toBe(true);
    expect(globToRegex("**/*.rs").test("c.rs")).toBe(true);
    expect(globToRegex("*.rs").test("main.rs")).toBe(true);
    expect(globToRegex("*.rs").test("src/main.rs")).toBe(false);
    expect(globToRegex("src/*.ts").test("src/app.ts")).toBe(true);
    expect(globToRegex("file?.txt").test("file1.txt")).toBe(true);
    expect(globToRegex("file?.txt").test("file10.txt")).toBe(false);
  });

  test("handles character classes and literals", () => {
    expect(globToRegex("file[0-9].txt").test("file7.txt")).toBe(true);
    expect(globToRegex("file[!0-9].txt").test("file7.txt")).toBe(false);
    expect(globToRegex("file[!0-9].txt").test("fileA.txt")).toBe(true);
    // A dot is a literal dot, not a regex wildcard.
    expect(globToRegex("a.rs").test("axrs")).toBe(false);
  });
});
