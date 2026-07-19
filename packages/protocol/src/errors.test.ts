import { describe, expect, test } from "bun:test";
import { RuntimeError } from "./errors";

describe("RuntimeError.http", () => {
  test("extracts the human message from provider bodies", () => {
    // ChatGPT backend shape.
    expect(
      RuntimeError.http(
        400,
        '{"detail":"The \'gpt-5.6\' model is not supported when using Codex with a ChatGPT account."}',
      ).message,
    ).toBe(
      "The 'gpt-5.6' model is not supported when using Codex with a ChatGPT account. (HTTP 400)",
    );
    // OpenAI / Anthropic API shape.
    expect(
      RuntimeError.http(401, '{"error":{"message":"Invalid API key."}}')
        .message,
    ).toBe("Invalid API key. (HTTP 401)");
    // Bare-string error field.
    expect(RuntimeError.http(429, '{"error":"Rate limited."}').message).toBe(
      "Rate limited. (HTTP 429)",
    );
    // Top-level message field.
    expect(RuntimeError.http(500, '{"message":"Overloaded."}').message).toBe(
      "Overloaded. (HTTP 500)",
    );
  });

  test("falls back for unparseable or empty bodies", () => {
    expect(RuntimeError.http(502, "<html>Bad Gateway</html>").message).toBe(
      "<html>Bad Gateway</html> (HTTP 502)",
    );
    expect(RuntimeError.http(500, "  ").message).toBe(
      "The provider request failed. (HTTP 500)",
    );
    // A long opaque body is truncated rather than dumped wholesale.
    expect(
      RuntimeError.http(500, "x".repeat(1000)).message.length,
    ).toBeLessThan(350);
  });

  test("truncation counts code points, not UTF-16 units", () => {
    const body = "😀".repeat(400);
    const message = RuntimeError.http(500, body).message;
    // 300 code points of astral emoji = 600 UTF-16 units + " (HTTP 500)".
    expect([...message.replace(" (HTTP 500)", "")].length).toBe(300);
  });

  test("records the http status and stays an Error", () => {
    const error = RuntimeError.http(429, "{}");
    expect(error.httpStatus).toBe(429);
    expect(error).toBeInstanceOf(Error);
    expect(RuntimeError.msg("boom").message).toBe("boom");
    expect(RuntimeError.invalidResponse().message).toBe(
      "The provider returned an invalid response.",
    );
  });
});
