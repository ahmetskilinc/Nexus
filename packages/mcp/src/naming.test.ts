import { describe, expect, test } from "bun:test";
import { namespacedToolName } from "./naming";

describe("namespacedToolName", () => {
  test("namespaces plain names", () => {
    expect(namespacedToolName("linear", "create_issue")).toBe(
      "mcp__linear__create_issue",
    );
  });

  test("sanitizes characters outside [A-Za-z0-9_-]", () => {
    expect(namespacedToolName("my server!", "do.thing")).toBe(
      "mcp__my_server___do_thing",
    );
    expect(namespacedToolName("ünïcode", "a/b:c")).toBe("mcp___n_code__a_b_c");
  });

  test("keeps hyphens and underscores", () => {
    expect(namespacedToolName("a-b_c", "d-e_f")).toBe("mcp__a-b_c__d-e_f");
  });

  test("caps the total name at 64 characters", () => {
    const name = namespacedToolName("server", "x".repeat(100));
    expect(name.length).toBe(64);
    expect(name.startsWith("mcp__server__xxx")).toBe(true);
  });
});
