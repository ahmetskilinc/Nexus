import { expect, test } from "bun:test";
import { naturalCompare } from "./natural-compare";

test("natural compare orders numeric runs", () => {
  expect(naturalCompare("file2.txt", "file10.txt")).toBeLessThan(0);
  expect(naturalCompare("File.txt", "file.txt")).toBeLessThan(0);
  expect(naturalCompare("a", "a")).toBe(0);
});
