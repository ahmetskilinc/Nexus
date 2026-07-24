import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { indexWorkspace, inspectWorkspace } from "./indexer";

const created: string[] = [];

function tempWorkspace(prefix: string): string {
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

test("index skips hidden and generated directories", async () => {
  const dir = tempWorkspace("nexus-ws-test-");
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.mkdirSync(path.join(dir, "node_modules/pkg"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src/main.rs"), "fn main() {}");
  fs.writeFileSync(path.join(dir, "node_modules/pkg/index.js"), "x");
  fs.writeFileSync(path.join(dir, ".hidden"), "x");
  fs.mkdirSync(path.join(dir, ".github"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".github/workflows.yml"), "x");
  fs.writeFileSync(path.join(dir, ".env.example"), "TOKEN=");
  fs.writeFileSync(path.join(dir, "README.md"), "x");

  const files = await indexWorkspace(dir);
  expect(files).toEqual([
    ".env.example",
    ".github/workflows.yml",
    "README.md",
    "src/main.rs",
  ]);
});

test("inspect summarizes visible root entries", async () => {
  const dir = tempWorkspace("nexus-inspect-test-");
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "README.md"), "x");
  fs.writeFileSync(path.join(dir, ".hidden"), "x");

  const report = await inspectWorkspace(dir);
  expect(report.workspaceSummary).toBe(
    "2 visible items at the workspace root.\nREADME.md\n[dir] src",
  );
  expect(report.gitSummary.length).toBeGreaterThan(0);
});
