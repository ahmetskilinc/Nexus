import { expect, test } from "bun:test";
import { statusFromCode } from "./status";

test("status codes preserve index and worktree meaning", () => {
  expect(statusFromCode("??")).toBe("untracked");
  expect(statusFromCode("M ")).toBe("modified");
  expect(statusFromCode(" D")).toBe("deleted");
  expect(statusFromCode("UU")).toBe("conflicted");
  expect(statusFromCode("R ")).toBe("renamed");
});
