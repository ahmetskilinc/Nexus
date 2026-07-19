import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { cleanup, temporaryPath } from "./testutil";
import { indexWorkspace, naturalCompare } from "./workspace-index";

describe("indexWorkspace", () => {
  test("skips hidden and generated directories", () => {
    const dir = temporaryPath("nexus-ws-test");
    fs.mkdirSync(path.join(dir, "src"));
    fs.mkdirSync(path.join(dir, "node_modules/pkg"), { recursive: true });
    fs.mkdirSync(path.join(dir, ".git"));
    fs.writeFileSync(path.join(dir, "src/main.rs"), "fn main() {}");
    fs.writeFileSync(path.join(dir, "node_modules/pkg/index.js"), "x");
    fs.writeFileSync(path.join(dir, ".hidden"), "x");
    fs.writeFileSync(path.join(dir, "README.md"), "x");

    expect(indexWorkspace(dir)).toEqual(["README.md", "src/main.rs"]);
    cleanup(dir);
  });
});

describe("naturalCompare", () => {
  test("orders numeric runs by value", () => {
    expect(naturalCompare("file2.txt", "file10.txt")).toBeLessThan(0);
    expect(naturalCompare("File.txt", "file.txt")).toBeLessThan(0);
    expect(naturalCompare("a", "a")).toBe(0);
  });
});
