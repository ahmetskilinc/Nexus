import { describe, expect, test } from "bun:test";
import { looksBinary, percentDecode } from "./util";

describe("percentDecode", () => {
  test("handles escapes, plus, and garbage", () => {
    expect(percentDecode("a%20b%2Fc")).toBe("a b/c");
    expect(percentDecode("a+b")).toBe("a b");
    expect(percentDecode("100%")).toBe("100%");
    expect(percentDecode("%zz")).toBe("%zz");
  });
});

describe("looksBinary", () => {
  test("detects NUL within the 8 KiB window", () => {
    expect(looksBinary(Buffer.from("abc\0def"))).toBe(true);
    expect(looksBinary(Buffer.from("plain text"))).toBe(false);
    const lateNul = Buffer.concat([Buffer.alloc(9000, "a"), Buffer.from([0])]);
    expect(looksBinary(lateNul)).toBe(false);
  });
});
