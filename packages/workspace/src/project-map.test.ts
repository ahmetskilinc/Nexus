import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { projectMap } from "./project-map";

const created: string[] = [];
afterEach(() => {
  while (created.length)
    fs.rmSync(created.pop() as string, { recursive: true, force: true });
});

test("projectMap summarizes local file languages and top-level entries", async () => {
  const workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), "nexus-project-map-"),
  );
  created.push(workspace);
  fs.mkdirSync(path.join(workspace, "src"));
  fs.writeFileSync(path.join(workspace, "src/app.ts"), "export {};");
  fs.writeFileSync(path.join(workspace, "README.md"), "# App");
  fs.writeFileSync(path.join(workspace, ".env"), "SECRET=x");
  await expect(projectMap(workspace)).resolves.toEqual({
    files: 2,
    languages: [
      { language: "Markdown", files: 1 },
      { language: "TypeScript", files: 1 },
    ],
    topLevel: ["README.md", "src/"],
  });
});
