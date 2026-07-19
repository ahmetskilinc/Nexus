import { describe, expect, test } from "bun:test";
import { decodeJwtClaims } from "./jwt";

describe("decodeJwtClaims", () => {
  /// Port of the Rust `jwt_claims_decodes_payload` test.
  test("decodes the payload segment", () => {
    const payload = Buffer.from(
      '{"email":"user@example.com","exp":1700000000}',
    ).toString("base64url");
    const claims = decodeJwtClaims(`header.${payload}.signature`);
    expect(claims.email).toBe("user@example.com");
    expect(claims.exp).toBe(1_700_000_000);
    expect(decodeJwtClaims("garbage")).toEqual({});
  });

  test("returns an empty object for anything malformed", () => {
    expect(decodeJwtClaims("")).toEqual({});
    /// Invalid base64url characters.
    expect(decodeJwtClaims("a.!!!.c")).toEqual({});
    /// Valid base64url but not JSON.
    expect(
      decodeJwtClaims(`a.${Buffer.from("not json").toString("base64url")}.c`),
    ).toEqual({});
    /// Valid JSON but not an object.
    expect(
      decodeJwtClaims(`a.${Buffer.from("[1,2]").toString("base64url")}.c`),
    ).toEqual({});
    expect(
      decodeJwtClaims(`a.${Buffer.from("5").toString("base64url")}.c`),
    ).toEqual({});
  });

  test("decodes nested claims like the OpenAI auth object", () => {
    const payload = Buffer.from(
      JSON.stringify({
        "https://api.openai.com/auth": { chatgpt_account_id: "acc_1" },
        exp: 1_700_000_000,
      }),
    ).toString("base64url");
    const claims = decodeJwtClaims(`h.${payload}.s`);
    expect(claims["https://api.openai.com/auth"]).toEqual({
      chatgpt_account_id: "acc_1",
    });
  });
});
