import { describe, expect, test } from "bun:test";
import { asArray, asNumber, asRecord, asString, get } from "./json";

describe("tolerant json accessors", () => {
  test("primitives", () => {
    expect(asString("a")).toBe("a");
    expect(asString(1)).toBeUndefined();
    expect(asNumber(1.5)).toBe(1.5);
    expect(asNumber(Number.NaN)).toBeUndefined();
    expect(asNumber("1")).toBeUndefined();
    expect(asArray([1])).toEqual([1]);
    expect(asArray({})).toBeUndefined();
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(asRecord([1])).toBeUndefined();
    expect(asRecord(null)).toBeUndefined();
  });

  test("get walks nested paths without throwing", () => {
    const value = { a: [{ b: "found" }] };
    expect(get(value, "a", 0, "b")).toBe("found");
    expect(get(value, "a", 1, "b")).toBeUndefined();
    expect(get(value, "missing", "deep", 3)).toBeUndefined();
    expect(get(null, "a")).toBeUndefined();
    expect(asString(get(value, "a", 0, "b"))).toBe("found");
  });
});
