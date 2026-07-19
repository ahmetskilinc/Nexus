import { describe, expect, test } from "bun:test";
import { bindLoopback, sanitizeDetail } from "./loopback";

/// Every test binds port 0 (ephemeral) and talks to the listener over a REAL
/// socket via fetch, exactly as a browser redirect would.
async function bound() {
  const listener = await bindLoopback(0);
  const callback = (query: string) =>
    fetch(`http://127.0.0.1:${listener.port}/auth/callback?${query}`);
  return { listener, callback };
}

describe("bindLoopback", () => {
  test("reports a busy port with the exact user-facing message", async () => {
    const first = await bindLoopback(0);
    try {
      await expect(bindLoopback(first.port)).rejects.toThrow(
        `Port ${first.port} is already in use. Quit the process listening on it (for example a Codex CLI login) and try again.`,
      );
    } finally {
      await first.close();
    }
  });
});

describe("waitForCode", () => {
  test("resolves the decoded code for a callback with matching state", async () => {
    const { listener, callback } = await bound();
    const pending = listener.waitForCode("the-state");
    const response = await callback("code=a%20b%2Fc&state=the-state");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(
      "Signed in. You can close this tab and return to Nexus.",
    );
    expect(await pending).toBe("a b/c");
  });

  test("a state mismatch is ignored and the listener keeps waiting", async () => {
    const { listener, callback } = await bound();
    const pending = listener.waitForCode("expected");
    /// Forged callback: 400, but the flow is NOT aborted — even with error=.
    const forged = await callback("code=evil&state=wrong&error=access_denied");
    expect(forged.status).toBe(400);
    expect(await forged.text()).toContain("Invalid request.");
    /// The genuine callback still succeeds afterwards.
    const genuine = await callback("code=real&state=expected");
    expect(genuine.status).toBe(200);
    expect(await pending).toBe("real");
  });

  test("non-callback paths get a 404 and the listener keeps waiting", async () => {
    const { listener } = await bound();
    const pending = listener.waitForCode("s");
    const favicon = await fetch(
      `http://127.0.0.1:${listener.port}/favicon.ico`,
    );
    expect(favicon.status).toBe(404);
    expect(await favicon.text()).toContain("Not found.");
    await fetch(
      `http://127.0.0.1:${listener.port}/auth/callback?code=c&state=s`,
    );
    expect(await pending).toBe("c");
  });

  test("error with valid state fails cleanly with a sanitized detail", async () => {
    const { listener, callback } = await bound();
    /// A no-op catch marks the rejection handled before it fires; the real
    /// assertion re-awaits the promise below.
    const pending = listener.waitForCode("s");
    pending.catch(() => {});
    const description = encodeURIComponent(`badnews\n${"x".repeat(250)}`);
    const response = await callback(
      `state=s&error=access_denied&error_description=${description}`,
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain(
      "Sign-in failed. You can close this tab.",
    );
    await expect(pending).rejects.toThrow(
      `Sign-in was not completed: ${"badnews".concat("x".repeat(193))}`,
    );
  });

  test("error without a description falls back to the error code", async () => {
    const { listener, callback } = await bound();
    const pending = listener.waitForCode("s");
    pending.catch(() => {});
    await callback("state=s&error=access_denied");
    await expect(pending).rejects.toThrow(
      "Sign-in was not completed: access_denied",
    );
  });

  test("a callback with valid state but no code fails cleanly", async () => {
    const { listener, callback } = await bound();
    const pending = listener.waitForCode("s");
    pending.catch(() => {});
    const response = await callback("state=s");
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Missing authorization code.");
    await expect(pending).rejects.toThrow(
      "Nexus could not complete the ChatGPT sign-in: The callback had no authorization code.",
    );
  });

  test("times out with the exact user-facing message", async () => {
    const { listener } = await bound();
    await expect(listener.waitForCode("s", 30)).rejects.toThrow(
      "Sign-in timed out. Try again.",
    );
  });
});

describe("sanitizeDetail", () => {
  test("strips control characters and caps at 200 code points", () => {
    expect(sanitizeDetail("a b\nc\td")).toBe("a bcd");
    expect(sanitizeDetail("y".repeat(500))).toBe("y".repeat(200));
    expect(sanitizeDetail("plain")).toBe("plain");
  });
});
