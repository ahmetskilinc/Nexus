import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { cleanup, fixture, temporaryPath } from "./testutil";
import { Toolbox } from "./toolbox";

const unix = process.platform !== "win32";

describe("read_file", () => {
  test("honors line ranges", async () => {
    const { dir, toolbox } = fixture();
    const output = await toolbox.execute("read_file", {
      path: "src/lib.rs",
      start_line: 2,
      end_line: 3,
    });
    expect(output).toBe("2\tline two\n3\tline three");
    await expect(
      toolbox.execute("read_file", { path: "src/lib.rs", start_line: 99 }),
    ).rejects.toThrow("outside the file");
    cleanup(dir);
  });

  test("refuses binary files", async () => {
    const { dir, toolbox } = fixture();
    fs.writeFileSync(path.join(dir, "blob.bin"), Buffer.from([97, 0, 98]));
    expect(await toolbox.execute("read_file", { path: "blob.bin" })).toBe(
      "This is a binary file; its content cannot be displayed.",
    );
    cleanup(dir);
  });

  test("output is truncated at the limit", async () => {
    const dir = temporaryPath("nexus-trunc-test");
    fs.writeFileSync(path.join(dir, "big.txt"), "x".repeat(30_000));
    const toolbox = new Toolbox(dir);
    const output = await toolbox.execute("read_file", { path: "big.txt" });
    expect(output.endsWith("[Output truncated at 20000 characters]")).toBe(
      true,
    );
    cleanup(dir);
  });

  test.skipIf(!unix)("rejects symlinks outside the workspace", async () => {
    const { dir, toolbox } = fixture();
    const outside = path.join(os.tmpdir(), `nexus-outside-test-${process.pid}`);
    fs.writeFileSync(outside, "private");
    fs.symlinkSync(outside, path.join(dir, "outside.txt"));

    await expect(
      toolbox.execute("read_file", { path: "outside.txt" }),
    ).rejects.toThrow("resolves outside the workspace");

    fs.rmSync(outside, { force: true });
    cleanup(dir);
  });
});

describe("list_directory", () => {
  test("lists entries with directories marked", async () => {
    const { dir, toolbox } = fixture();
    fs.writeFileSync(path.join(dir, ".hidden"), "x");
    const output = await toolbox.execute("list_directory", {});
    expect(output).toBe("notes.txt\nsrc/");
    expect(await toolbox.execute("list_directory", { path: "src" })).toBe(
      "lib.rs",
    );
    cleanup(dir);
  });

  test("reports an empty directory", async () => {
    const { dir, toolbox } = fixture();
    fs.mkdirSync(path.join(dir, "empty"));
    expect(await toolbox.execute("list_directory", { path: "empty" })).toBe(
      "The directory is empty.",
    );
    cleanup(dir);
  });
});

describe("dispatch", () => {
  test("unknown tools are rejected", async () => {
    const { dir, toolbox } = fixture();
    await expect(toolbox.execute("not_a_tool", {})).rejects.toThrow(
      'unknown tool "not_a_tool".',
    );
    cleanup(dir);
  });
});
