import { describe, expect, test } from "bun:test";
import { renderToolResult } from "./hub";

describe("renderToolResult", () => {
  test("joins text parts with newlines", () => {
    const result = {
      content: [
        { type: "text", text: "one" },
        { type: "text", text: "two" },
      ],
    };
    expect(renderToolResult(result)).toBe("one\ntwo");
  });

  test("notes non-text parts and skips untyped ones", () => {
    const result = {
      content: [
        { type: "text", text: "before" },
        { type: "image", data: "aGk=" },
        { text: "no type" },
      ],
    };
    expect(renderToolResult(result)).toBe("before\n[image content omitted]\n");
  });

  test("stringifies results without a content array", () => {
    expect(renderToolResult({ value: 3 })).toBe('{"value":3}');
  });

  test("replaces empty output with a placeholder", () => {
    expect(renderToolResult({ content: [] })).toBe(
      "(the tool returned no content)",
    );
    expect(renderToolResult({ content: [{ type: "text", text: "  " }] })).toBe(
      "(the tool returned no content)",
    );
  });

  test("prefixes isError results", () => {
    const result = { isError: true, content: [{ type: "text", text: "boom" }] };
    expect(renderToolResult(result)).toBe("Error: boom");
    expect(renderToolResult({ isError: true, content: [] })).toBe(
      "Error: (the tool returned no content)",
    );
  });
});
