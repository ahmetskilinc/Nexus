import { describe, expect, test } from "bun:test";
import { isAvailable, kindOf, toolSchemas } from "./catalog/schemas";

describe("tool catalog", () => {
  test("web schemas gate on the flag", () => {
    expect(
      toolSchemas(false, "standard").some(
        (schema) => schema.name === "web_fetch",
      ),
    ).toBe(false);
    expect(
      toolSchemas(true, "standard").some(
        (schema) => schema.name === "web_fetch",
      ),
    ).toBe(true);
    expect(
      toolSchemas(true, "research").some(
        (schema) => schema.name === "web_search",
      ),
    ).toBe(true);
  });

  test("artifact schemas gate on the mode", () => {
    expect(isAvailable("write_plan", true, "standard")).toBe(false);
    expect(isAvailable("write_plan", false, "plan")).toBe(true);
    expect(isAvailable("write_research", true, "plan")).toBe(false);
    expect(isAvailable("write_research", false, "research")).toBe(true);
  });

  test("research mode is strictly read-only", () => {
    const names = toolSchemas(true, "research").map((schema) => schema.name);
    for (const allowed of [
      "read_file",
      "list_directory",
      "grep",
      "glob",
      "git_status",
      "git_diff",
      "web_fetch",
      "web_search",
      "spawn_agent",
      "write_research",
    ]) {
      expect(names).toContain(allowed);
    }
    for (const denied of [
      "edit_file",
      "write_file",
      "run_command",
      "todo_write",
      "write_plan",
      "memory_save",
      "memory_list",
    ]) {
      expect(names).not.toContain(denied);
    }
  });

  test("kindOf covers every schema and only schemas", () => {
    for (const schema of [
      ...toolSchemas(true, "plan"),
      ...toolSchemas(true, "research"),
    ]) {
      expect(kindOf(schema.name)).toBeDefined();
    }
    expect(kindOf("run_command")).toBe("command");
    expect(kindOf("todo_write")).toBe("todo");
    expect(kindOf("write_plan")).toBe("plan");
    expect(kindOf("write_research")).toBe("research");
    expect(kindOf("edit_file")).toBe("mutating");
    expect(kindOf("web_fetch")).toBe("web");
    expect(kindOf("read_file")).toBe("readOnly");
    expect(kindOf("not_a_tool")).toBeUndefined();
  });
});
