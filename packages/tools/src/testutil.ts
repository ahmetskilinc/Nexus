/// Shared test fixtures, mirroring the Rust `tools::testutil` module.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Toolbox } from "./toolbox";

export function temporaryPath(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

export function fixture(): { dir: string; toolbox: Toolbox } {
  const dir = temporaryPath("nexus-tools-test");
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(
    path.join(dir, "src/lib.rs"),
    "line one\nline two\nline three\nline four\n",
  );
  fs.writeFileSync(path.join(dir, "notes.txt"), "alpha\nbeta\ngamma\n");
  return { dir, toolbox: new Toolbox(dir) };
}

export function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}
