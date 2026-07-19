import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ToolError } from "@nexus/protocol";
import { planMutation } from "./mutation-plan";
import { cleanup, fixture } from "./testutil";

const unix = process.platform !== "win32";

describe("workspace confinement", () => {
  test("read_file rejects paths outside the workspace", async () => {
    const { dir, toolbox } = fixture();
    await expect(
      toolbox.execute("read_file", { path: "../etc/passwd" }),
    ).rejects.toThrow("resolves outside the workspace");
    await expect(
      toolbox.execute("read_file", { path: "src/../../elsewhere" }),
    ).rejects.toThrow("resolves outside the workspace");
    await expect(
      toolbox.execute("read_file", { path: "../etc/passwd" }),
    ).rejects.toBeInstanceOf(ToolError);
    cleanup(dir);
  });

  test("write_file rejects paths outside the workspace", async () => {
    const { dir } = fixture();
    await expect(
      planMutation(dir, "write_file", { path: "../escape.txt", content: "x" }),
    ).rejects.toThrow("resolves outside the workspace");
    cleanup(dir);
  });

  test.skipIf(!unix)(
    "write and create reject a dangling symlink leaf",
    async () => {
      const { dir } = fixture();
      // A symlink checked into the workspace whose target does not exist
      // yet. Writing through it would follow the link and escape.
      const outside = path.join(
        os.tmpdir(),
        `nexus-symlink-escape-target-${process.pid}`,
      );
      fs.rmSync(outside, { force: true });
      fs.symlinkSync(outside, path.join(dir, "evil"));

      await expect(
        planMutation(dir, "write_file", { path: "evil", content: "x" }),
      ).rejects.toThrow("symlink");
      await expect(
        planMutation(dir, "create_file", { path: "evil", content: "x" }),
      ).rejects.toThrow("symlink");

      expect(fs.existsSync(outside)).toBe(false);
      cleanup(dir);
    },
  );

  test.skipIf(!unix)(
    "a symlinked directory cannot redirect reads outside",
    async () => {
      const { dir, toolbox } = fixture();
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-outside-"));
      fs.writeFileSync(path.join(outside, "secret.txt"), "private");
      fs.symlinkSync(outside, path.join(dir, "link"));

      await expect(
        toolbox.execute("read_file", { path: "link/secret.txt" }),
      ).rejects.toThrow("resolves outside the workspace");

      cleanup(outside);
      cleanup(dir);
    },
  );
});
