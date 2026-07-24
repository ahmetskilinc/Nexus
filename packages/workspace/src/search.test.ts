import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { searchWorkspaceText } from "./search";

const created: string[] = [];

afterEach(() => {
  while (created.length)
    fs.rmSync(created.pop() as string, { recursive: true, force: true });
});

test("searchWorkspaceText finds literal text and skips hidden secrets and binaries", async () => {
  const workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), "nexus-search-test-"),
  );
  created.push(workspace);
  fs.mkdirSync(path.join(workspace, "src"));
  fs.writeFileSync(
    path.join(workspace, "src/main.ts"),
    "const Needle = true;\nneedle again\n",
  );
  fs.writeFileSync(path.join(workspace, ".env"), "NEEDLE=secret\n");
  fs.writeFileSync(path.join(workspace, "binary.dat"), Buffer.from([0, 1, 2]));

  expect(await searchWorkspaceText(workspace, "needle")).toEqual([
    { path: "src/main.ts", line: 1, text: "const Needle = true;" },
    { path: "src/main.ts", line: 2, text: "needle again" },
  ]);
});
