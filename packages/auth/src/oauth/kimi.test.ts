import { describe, expect, test } from "bun:test";
import { collectingEmitter } from "@nexus/protocol";
import { InMemoryCredentialStore } from "../credential-store";
import { loadTokens } from "../tokens";
import { kimiDeviceHeaders, refreshKimi, signInKimi } from "./kimi";

interface Recorded {
  url: string;
  body: string;
  headers: Record<string, string>;
}

/// A fetch double that records every request and answers from a fixed queue.
function queuedFetch(responses: Response[]): {
  fetchFn: typeof fetch;
  requests: Recorded[];
} {
  const requests: Recorded[] = [];
  const fetchFn = (async (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ) => {
    requests.push({
      url: String(input),
      body: String(init?.body),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const next = responses.shift();
    if (next === undefined) throw new Error("unexpected extra request");
    return next;
  }) as typeof fetch;
  return { fetchFn, requests };
}

const GRANT = {
  device_code: "dc-1",
  user_code: "AB-12",
  verification_uri: "https://auth.kimi.com/verify",
  verification_uri_complete: "https://auth.kimi.com/verify?code=AB-12",
  interval: 0,
  expires_in: 300,
};

describe("kimiDeviceHeaders", () => {
  test("carries the kimi-cli fingerprint and a stable minted device id", async () => {
    const store = new InMemoryCredentialStore();
    const headers = await kimiDeviceHeaders(store);
    expect(headers["User-Agent"]).toBe("KimiCLI/1.9.0");
    expect(headers["X-Msh-Platform"]).toBe("kimi_cli");
    expect(headers["X-Msh-Version"]).toBe("1.9.0");
    expect(headers["X-Msh-Device-Name"]).toBe("Nexus");
    if (process.platform === "darwin") {
      /// Node's "darwin" is reported as Rust's std::env::consts::OS value.
      expect(headers["X-Msh-Os-Version"]).toBe("macos");
    }
    if (process.arch === "arm64") {
      expect(headers["X-Msh-Device-Model"]).toBe("aarch64");
    }
    const deviceId = headers["X-Msh-Device-Id"] as string;
    expect(deviceId).toMatch(/^[0-9a-f-]{36}$/);
    /// Minted once, persisted, and reused.
    expect(await store.get("kimi.device_id")).toBe(deviceId);
    expect((await kimiDeviceHeaders(store))["X-Msh-Device-Id"]).toBe(deviceId);
  });
});

describe("signInKimi", () => {
  test("polls through pending and slow_down to success", async () => {
    const store = new InMemoryCredentialStore();
    const emitter = collectingEmitter();
    const { fetchFn, requests } = queuedFetch([
      Response.json(GRANT),
      Response.json({ error: "authorization_pending" }, { status: 400 }),
      Response.json({ error: "slow_down" }, { status: 400 }),
      Response.json({
        access_token: "at-1",
        refresh_token: "rt-1",
        expires_in: 900,
      }),
    ]);
    const result = await signInKimi({
      store,
      emitter,
      providerId: "kimi",
      fetchFn,
      pollIntervalMsOverride: 1,
    });
    /// Kimi issues no id token or account id.
    expect(result).toEqual({ email: undefined, accountId: undefined });

    expect(emitter.events).toEqual([
      {
        type: "authorize_url",
        url: "https://auth.kimi.com/verify?code=AB-12",
        userCode: "AB-12",
      },
    ]);

    expect(requests).toHaveLength(4);
    expect(requests[0]?.url).toBe(
      "https://auth.kimi.com/api/oauth/device_authorization",
    );
    expect(requests[0]?.body).toBe(
      "client_id=17e5f671-d194-4dfb-9706-5516cb48c098",
    );
    expect(requests[1]?.url).toBe("https://auth.kimi.com/api/oauth/token");
    expect(requests[1]?.body).toBe(
      "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code&device_code=dc-1&client_id=17e5f671-d194-4dfb-9706-5516cb48c098",
    );
    const deviceId = requests[0]?.headers["X-Msh-Device-Id"];
    expect(deviceId).toBeDefined();
    for (const request of requests) {
      expect(request.headers["Content-Type"]).toBe(
        "application/x-www-form-urlencoded",
      );
      expect(request.headers["User-Agent"]).toBe("KimiCLI/1.9.0");
      expect(request.headers["X-Msh-Device-Id"]).toBe(deviceId as string);
    }

    const stored = await loadTokens(store, "kimi");
    expect(stored?.accessToken).toBe("at-1");
    expect(stored?.refreshToken).toBe("rt-1");
    expect(stored?.idToken).toBeUndefined();
    expect(stored?.accountId).toBeUndefined();
  });

  test("falls back to verification_uri and omits a missing user code", async () => {
    const store = new InMemoryCredentialStore();
    const emitter = collectingEmitter();
    const { fetchFn } = queuedFetch([
      Response.json({
        device_code: "dc",
        verification_uri: "https://auth.kimi.com/verify",
      }),
      Response.json({ access_token: "at", refresh_token: "rt" }),
    ]);
    await signInKimi({
      store,
      emitter,
      providerId: "kimi",
      fetchFn,
      pollIntervalMsOverride: 1,
    });
    expect(emitter.events).toEqual([
      { type: "authorize_url", url: "https://auth.kimi.com/verify" },
    ]);
  });

  test("a malformed device grant fails with the exact message", async () => {
    const { fetchFn } = queuedFetch([Response.json({})]);
    await expect(
      signInKimi({
        store: new InMemoryCredentialStore(),
        emitter: collectingEmitter(),
        providerId: "kimi",
        fetchFn,
        pollIntervalMsOverride: 1,
      }),
    ).rejects.toThrow(
      "Nexus could not complete the Kimi sign-in: The device-authorization response was malformed.",
    );
  });

  test("a denial during polling surfaces the error description", async () => {
    const { fetchFn } = queuedFetch([
      Response.json(GRANT),
      Response.json({ error: "authorization_pending" }, { status: 400 }),
      Response.json(
        { error: "access_denied", error_description: "Denied" },
        { status: 400 },
      ),
    ]);
    await expect(
      signInKimi({
        store: new InMemoryCredentialStore(),
        emitter: collectingEmitter(),
        providerId: "kimi",
        fetchFn,
        pollIntervalMsOverride: 1,
      }),
    ).rejects.toThrow("Nexus could not complete the Kimi sign-in: Denied");
  });

  test("times out once the grant's expires_in deadline passes", async () => {
    const { fetchFn } = queuedFetch([
      Response.json({ ...GRANT, expires_in: 0 }),
    ]);
    await expect(
      signInKimi({
        store: new InMemoryCredentialStore(),
        emitter: collectingEmitter(),
        providerId: "kimi",
        fetchFn,
        pollIntervalMsOverride: 1,
      }),
    ).rejects.toThrow("Sign-in timed out. Try again.");
  });
});

describe("refreshKimi", () => {
  const NOW = 1_750_000_000_000;

  test("keeps the previous refresh token and email when omitted", async () => {
    const store = new InMemoryCredentialStore();
    const { fetchFn } = queuedFetch([
      Response.json({ access_token: "at-2", expires_in: 900 }),
    ]);
    const tokens = await refreshKimi(
      store,
      { accessToken: "at-1", refreshToken: "rt-1", email: "k@x.com" },
      fetchFn,
      () => NOW,
    );
    expect(tokens.refreshToken).toBe("rt-1");
    expect(tokens.email).toBe("k@x.com");
    expect(tokens.expiresAt).toBe(NOW + 900_000);
  });

  test("a token response without an access token is malformed", async () => {
    const store = new InMemoryCredentialStore();
    const { fetchFn } = queuedFetch([Response.json({ refresh_token: "rt" })]);
    await expect(
      refreshKimi(
        store,
        { accessToken: "a", refreshToken: "r" },
        fetchFn,
        () => NOW,
      ),
    ).rejects.toThrow(
      "Nexus could not complete the Kimi sign-in: The token response was malformed.",
    );
  });
});
