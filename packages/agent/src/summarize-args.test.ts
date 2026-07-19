import { describe, expect, test } from "bun:test";
import { summarizeArgs } from "./summarize-args";

describe("summarizeArgs", () => {
  test("sorts keys and caps length", () => {
    expect(summarizeArgs('{"path": "a.txt", "end_line": 3}')).toBe(
      "end_line: 3, path: a.txt",
    );
    expect(summarizeArgs("{}")).toBe("");
    expect(summarizeArgs("not json")).toBe("");
    const long = `{"pattern": "${"x".repeat(300)}"}`;
    expect([...summarizeArgs(long)].length).toBe(140);
  });

  test("non-object json renders empty", () => {
    expect(summarizeArgs('["array"]')).toBe("");
    expect(summarizeArgs('"string"')).toBe("");
  });
});
