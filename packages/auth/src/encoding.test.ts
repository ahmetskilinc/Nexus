import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  base64Url,
  createPkce,
  formEncode,
  percentDecode,
  percentEncode,
  randomState,
} from "./encoding";

describe("percent coding", () => {
  /// Port of the Rust `percent_coding_round_trips` test.
  test("round trips", () => {
    expect(percentEncode("a b/c")).toBe("a%20b%2Fc");
    expect(percentDecode("a%20b%2Fc")).toBe("a b/c");
    expect(percentDecode("a+b")).toBe("a b");
  });

  /// Port of the Rust `percent_decode_handles_escapes_plus_and_garbage` test.
  test("decode leaves invalid escapes as-is", () => {
    expect(percentDecode("100%")).toBe("100%");
    expect(percentDecode("%zz")).toBe("%zz");
  });

  test("encode leaves the unreserved set alone and uses uppercase hex", () => {
    expect(percentEncode("AZaz09-._~")).toBe("AZaz09-._~");
    expect(percentEncode("a=b&c?d")).toBe("a%3Db%26c%3Fd");
    expect(percentEncode("é")).toBe("%C3%A9");
  });
});

describe("formEncode", () => {
  test("encodes values but not keys", () => {
    expect(
      formEncode([
        ["grant_type", "authorization_code"],
        ["code", "a b/c"],
      ]),
    ).toBe("grant_type=authorization_code&code=a%20b%2Fc");
  });
});

describe("base64Url and PKCE", () => {
  test("base64Url is unpadded and URL-safe", () => {
    expect(base64Url(Buffer.from([0xfb, 0xef, 0xff]))).toBe("--__");
    expect(base64Url("a")).toBe("YQ");
  });

  test("challenge is the S256 hash of the verifier", () => {
    const { verifier, challenge } = createPkce();
    /// 64 random bytes → 86 base64url chars.
    expect(verifier).toHaveLength(86);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    const expected = createHash("sha256")
      .update(verifier, "utf8")
      .digest()
      .toString("base64url");
    expect(challenge).toBe(expected);
    expect(createPkce().verifier).not.toBe(verifier);
  });

  test("randomState is 43 base64url chars and unique", () => {
    const state = randomState();
    expect(state).toHaveLength(43);
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(randomState()).not.toBe(state);
  });
});
