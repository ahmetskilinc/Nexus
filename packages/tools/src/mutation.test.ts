import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { applyMutation } from "./mutation-apply";
import { planMutation } from "./mutation-plan";
import { cleanup, fixture } from "./testutil";

const unix = process.platform !== "win32";

describe("planMutation/applyMutation", () => {
  test("write_file creates and overwrites", async () => {
    const { dir } = fixture();
    let plan = await planMutation(dir, "write_file", {
      path: "src/new.rs",
      content: "hi\n",
    });
    expect(plan.before).toBe("");
    expect(plan.message).toContain("Created src/new.rs");
    await applyMutation(dir, plan);
    expect(fs.readFileSync(path.join(dir, "src/new.rs"), "utf8")).toBe("hi\n");

    plan = await planMutation(dir, "write_file", {
      path: "src/new.rs",
      content: "bye\n",
    });
    expect(plan.before).toBe("hi\n");
    expect(plan.message).toContain("Wrote src/new.rs");
    await applyMutation(dir, plan);
    expect(fs.readFileSync(path.join(dir, "src/new.rs"), "utf8")).toBe("bye\n");
    cleanup(dir);
  });

  test("write_file creates parent directories", async () => {
    const { dir } = fixture();
    const plan = await planMutation(dir, "write_file", {
      path: "a/b/c.txt",
      content: "x",
    });
    await applyMutation(dir, plan);
    expect(fs.readFileSync(path.join(dir, "a/b/c.txt"), "utf8")).toBe("x");
    cleanup(dir);
  });

  test("create_file rejects existing", async () => {
    const { dir } = fixture();
    await expect(
      planMutation(dir, "create_file", { path: "notes.txt" }),
    ).rejects.toThrow("already exists");
    cleanup(dir);
  });

  test("edit_file requires a unique match", async () => {
    const { dir } = fixture();
    // "line" appears on every line of src/lib.rs.
    await expect(
      planMutation(dir, "edit_file", {
        path: "src/lib.rs",
        old_string: "line",
        new_string: "LINE",
      }),
    ).rejects.toThrow("appears 4 times");

    let plan = await planMutation(dir, "edit_file", {
      path: "src/lib.rs",
      old_string: "line",
      new_string: "LINE",
      replace_all: true,
    });
    expect(plan.message).toContain("4 replacements");

    plan = await planMutation(dir, "edit_file", {
      path: "src/lib.rs",
      old_string: "line two",
      new_string: "line 2",
    });
    expect(plan.after).toContain("line 2");
    expect(plan.message).toContain("1 replacement)");
    cleanup(dir);
  });

  test("edit_file reports missing text", async () => {
    const { dir } = fixture();
    await expect(
      planMutation(dir, "edit_file", {
        path: "notes.txt",
        old_string: "absent",
        new_string: "x",
      }),
    ).rejects.toThrow("was not found");
    cleanup(dir);
  });

  test("multi_edit applies edits in order", async () => {
    const { dir } = fixture();
    const plan = await planMutation(dir, "multi_edit", {
      path: "notes.txt",
      edits: [
        { old_string: "alpha", new_string: "ALPHA" },
        { old_string: "gamma", new_string: "GAMMA" },
      ],
    });
    expect(plan.after).toContain("ALPHA");
    expect(plan.after).toContain("GAMMA");
    expect(plan.message).toContain("2 edits");
    cleanup(dir);
  });

  test("multi_edit fails atomically on a missing match", async () => {
    const { dir } = fixture();
    await expect(
      planMutation(dir, "multi_edit", {
        path: "notes.txt",
        edits: [
          { old_string: "alpha", new_string: "ALPHA" },
          { old_string: "absent", new_string: "x" },
        ],
      }),
    ).rejects.toThrow("Edit 2 did not match");
    // The file on disk is untouched because nothing was applied.
    expect(fs.readFileSync(path.join(dir, "notes.txt"), "utf8")).toBe(
      "alpha\nbeta\ngamma\n",
    );
    cleanup(dir);
  });

  test("rename_file moves content", async () => {
    const { dir } = fixture();
    const plan = await planMutation(dir, "rename_file", {
      from: "notes.txt",
      to: "docs/notes.txt",
    });
    expect(plan.source).not.toBeNull();
    await applyMutation(dir, plan);
    expect(fs.existsSync(path.join(dir, "notes.txt"))).toBe(false);
    expect(fs.readFileSync(path.join(dir, "docs/notes.txt"), "utf8")).toBe(
      "alpha\nbeta\ngamma\n",
    );
    cleanup(dir);
  });

  test("rename_file rejects an existing destination", async () => {
    const { dir } = fixture();
    await expect(
      planMutation(dir, "rename_file", { from: "notes.txt", to: "src/lib.rs" }),
    ).rejects.toThrow("already exists");
    cleanup(dir);
  });

  test("delete_file removes the file", async () => {
    const { dir } = fixture();
    const plan = await planMutation(dir, "delete_file", { path: "notes.txt" });
    expect(plan.after).toBeNull();
    await applyMutation(dir, plan);
    expect(fs.existsSync(path.join(dir, "notes.txt"))).toBe(false);
    cleanup(dir);
  });

  test("apply rejects a file that changed after planning", async () => {
    const { dir } = fixture();
    const plan = await planMutation(dir, "edit_file", {
      path: "notes.txt",
      old_string: "beta",
      new_string: "BETA",
    });
    fs.writeFileSync(path.join(dir, "notes.txt"), "alpha\nCHANGED\ngamma\n");
    await expect(applyMutation(dir, plan)).rejects.toThrow(
      "changed on disk after this mutation was planned",
    );
    expect(fs.readFileSync(path.join(dir, "notes.txt"), "utf8")).toBe(
      "alpha\nCHANGED\ngamma\n",
    );
    cleanup(dir);
  });

  test("apply rejects a file created after a create plan", async () => {
    const { dir } = fixture();
    const plan = await planMutation(dir, "create_file", {
      path: "fresh.txt",
      content: "x",
    });
    fs.writeFileSync(path.join(dir, "fresh.txt"), "raced");
    await expect(applyMutation(dir, plan)).rejects.toThrow(
      "changed on disk after this mutation was planned",
    );
    expect(fs.readFileSync(path.join(dir, "fresh.txt"), "utf8")).toBe("raced");
    cleanup(dir);
  });

  test.skipIf(!unix)(
    "apply rejects a target swapped for a symlink after planning",
    async () => {
      const { dir } = fixture();
      const outside = path.join(
        os.tmpdir(),
        `nexus-toctou-target-${process.pid}`,
      );
      fs.rmSync(outside, { force: true });
      const plan = await planMutation(dir, "write_file", {
        path: "notes.txt",
        content: "overwritten",
      });
      // Swap the approved target for a symlink pointing outside.
      fs.rmSync(path.join(dir, "notes.txt"));
      fs.symlinkSync(outside, path.join(dir, "notes.txt"));

      await expect(applyMutation(dir, plan)).rejects.toThrow("symlink");
      expect(fs.existsSync(outside)).toBe(false);
      cleanup(dir);
    },
  );
});
