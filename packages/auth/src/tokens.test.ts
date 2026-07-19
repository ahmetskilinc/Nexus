import { describe, expect, test } from "bun:test";
import { InMemoryCredentialStore } from "./credential-store";
import {
  loadTokens,
  storeTokens,
  type Tokens,
  validAccessToken,
} from "./tokens";

const NOW = 1_750_000_000_000;
const now = () => NOW;

function fakeFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    handler(String(input), init ?? {})) as typeof fetch;
}

const rejectAllFetch = fakeFetch(() => {
  throw new Error("network must not be touched");
});

describe("token storage", () => {
  test("round trips through the <providerId>.oauth account", async () => {
    const store = new InMemoryCredentialStore();
    const tokens: Tokens = {
      idToken: "i",
      accessToken: "a",
      refreshToken: "r",
      accountId: "acc",
      email: "e@x.com",
      expiresAt: NOW + 60_000,
    };
    await storeTokens(store, "openai", tokens);
    const raw = await store.get("openai.oauth");
    expect(raw).toBeDefined();
    /// The new store format: camelCase names, expiresAt in Unix milliseconds.
    expect(JSON.parse(raw as string)).toEqual({
      idToken: "i",
      accessToken: "a",
      refreshToken: "r",
      accountId: "acc",
      email: "e@x.com",
      expiresAt: NOW + 60_000,
    });
    expect(await loadTokens(store, "openai")).toEqual(tokens);
  });

  test("optional fields are omitted from the stored JSON", async () => {
    const store = new InMemoryCredentialStore();
    await storeTokens(store, "kimi", { accessToken: "a", refreshToken: "r" });
    expect(JSON.parse((await store.get("kimi.oauth")) as string)).toEqual({
      accessToken: "a",
      refreshToken: "r",
    });
  });

  test("unreadable stored JSON loads as undefined", async () => {
    const store = new InMemoryCredentialStore();
    await store.set("openai.oauth", "not json");
    expect(await loadTokens(store, "openai")).toBeUndefined();
    await store.set("openai.oauth", '{"refreshToken":"r"}');
    expect(await loadTokens(store, "openai")).toBeUndefined();
  });
});

describe("validAccessToken", () => {
  test("no stored session fails with the re-connect message", async () => {
    const store = new InMemoryCredentialStore();
    await expect(
      validAccessToken(store, "openai", "openai", rejectAllFetch, now),
    ).rejects.toThrow(
      "This provider has no active session. Re-connect it from the sidebar.",
    );
  });

  test("a token outside the 300s margin is returned without refreshing", async () => {
    const store = new InMemoryCredentialStore();
    await storeTokens(store, "openai", {
      accessToken: "a",
      refreshToken: "r",
      accountId: "acc",
      expiresAt: NOW + 301_000,
    });
    const tokens = await validAccessToken(
      store,
      "openai",
      "openai",
      rejectAllFetch,
      now,
    );
    expect(tokens.accessToken).toBe("a");
    expect(tokens.accountId).toBe("acc");
  });

  test("a token with no expiry is never refreshed", async () => {
    const store = new InMemoryCredentialStore();
    await storeTokens(store, "openai", { accessToken: "a", refreshToken: "r" });
    const tokens = await validAccessToken(
      store,
      "openai",
      "openai",
      rejectAllFetch,
      now,
    );
    expect(tokens.accessToken).toBe("a");
  });

  test("a token inside the margin refreshes, rotates, and re-stores", async () => {
    const store = new InMemoryCredentialStore();
    await storeTokens(store, "openai", {
      idToken: "old-id",
      accessToken: "old-access",
      refreshToken: "old-refresh",
      expiresAt: NOW + 299_000,
    });
    const requests: { url: string; body: string }[] = [];
    const fetchFn = fakeFetch((url, init) => {
      requests.push({ url, body: String(init.body) });
      /// No id_token / refresh_token in the response: the previous ones stay.
      return Response.json({ access_token: "new-access" });
    });
    const tokens = await validAccessToken(
      store,
      "openai",
      "openai",
      fetchFn,
      now,
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://auth.openai.com/oauth/token");
    expect(JSON.parse(requests[0]?.body ?? "")).toEqual({
      client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
      grant_type: "refresh_token",
      refresh_token: "old-refresh",
    });
    expect(tokens.accessToken).toBe("new-access");
    expect(tokens.idToken).toBe("old-id");
    expect(tokens.refreshToken).toBe("old-refresh");
    /// The refreshed tokens were written back to the store.
    expect((await loadTokens(store, "openai"))?.accessToken).toBe("new-access");
  });

  test("a rotated refresh token replaces the stored one", async () => {
    const store = new InMemoryCredentialStore();
    await storeTokens(store, "openai", {
      accessToken: "old-access",
      refreshToken: "old-refresh",
      expiresAt: NOW - 1,
    });
    const fetchFn = fakeFetch(() =>
      Response.json({
        access_token: "new-access",
        refresh_token: "new-refresh",
      }),
    );
    await validAccessToken(store, "openai", "openai", fetchFn, now);
    expect((await loadTokens(store, "openai"))?.refreshToken).toBe(
      "new-refresh",
    );
  });

  test("permanent ChatGPT refresh failures ask for a re-connect", async () => {
    for (const failure of [
      "refresh_token_expired",
      "refresh_token_reused",
      "refresh_token_invalidated",
    ]) {
      const store = new InMemoryCredentialStore();
      await storeTokens(store, "openai", {
        accessToken: "a",
        refreshToken: "r",
        expiresAt: NOW,
      });
      const fetchFn = fakeFetch(
        () => new Response(`{"error":"${failure}"}`, { status: 400 }),
      );
      await expect(
        validAccessToken(store, "openai", "openai", fetchFn, now),
      ).rejects.toThrow(
        "Your ChatGPT session expired. Re-connect this provider from the sidebar.",
      );
    }
  });

  test("other ChatGPT refresh failures surface the response text", async () => {
    const store = new InMemoryCredentialStore();
    await storeTokens(store, "openai", {
      accessToken: "a",
      refreshToken: "r",
      expiresAt: NOW,
    });
    const fetchFn = fakeFetch(
      () => new Response("rate limited", { status: 429 }),
    );
    await expect(
      validAccessToken(store, "openai", "openai", fetchFn, now),
    ).rejects.toThrow(
      "Nexus could not complete the ChatGPT sign-in: rate limited",
    );
  });

  test("a malformed ChatGPT refresh response fails cleanly", async () => {
    const store = new InMemoryCredentialStore();
    await storeTokens(store, "openai", {
      accessToken: "a",
      refreshToken: "r",
      expiresAt: NOW,
    });
    const fetchFn = fakeFetch(() => new Response("{}", { status: 200 }));
    await expect(
      validAccessToken(store, "openai", "openai", fetchFn, now),
    ).rejects.toThrow(
      "Nexus could not complete the ChatGPT sign-in: The refresh response was malformed.",
    );
  });

  test("kimi tokens refresh through the Kimi endpoint with device headers", async () => {
    const store = new InMemoryCredentialStore();
    await storeTokens(store, "kimi", {
      accessToken: "old-access",
      refreshToken: "old-refresh",
      email: "k@x.com",
      expiresAt: NOW,
    });
    const requests: {
      url: string;
      body: string;
      headers: Record<string, string>;
    }[] = [];
    const fetchFn = fakeFetch((url, init) => {
      requests.push({
        url,
        body: String(init.body),
        headers: (init.headers ?? {}) as Record<string, string>,
      });
      return Response.json({ access_token: "new-access", expires_in: 900 });
    });
    const tokens = await validAccessToken(store, "kimi", "kimi", fetchFn, now);
    expect(requests[0]?.url).toBe("https://auth.kimi.com/api/oauth/token");
    expect(requests[0]?.body).toBe(
      "grant_type=refresh_token&refresh_token=old-refresh&client_id=17e5f671-d194-4dfb-9706-5516cb48c098",
    );
    expect(requests[0]?.headers["User-Agent"]).toBe("KimiCLI/1.9.0");
    expect(requests[0]?.headers["X-Msh-Device-Id"]).toBe(
      (await store.get("kimi.device_id")) as string,
    );
    expect(tokens.accessToken).toBe("new-access");
    /// No refresh_token in the response → the previous one is kept; email
    /// carries over; expiry comes from expires_in against the injected clock.
    expect(tokens.refreshToken).toBe("old-refresh");
    expect(tokens.email).toBe("k@x.com");
    expect(tokens.expiresAt).toBe(NOW + 900_000);
  });

  test("kimi invalid_grant asks for a re-connect", async () => {
    const store = new InMemoryCredentialStore();
    await storeTokens(store, "kimi", {
      accessToken: "a",
      refreshToken: "r",
      expiresAt: NOW,
    });
    const fetchFn = fakeFetch(() =>
      Response.json({ error: "invalid_grant" }, { status: 400 }),
    );
    await expect(
      validAccessToken(store, "kimi", "kimi", fetchFn, now),
    ).rejects.toThrow(
      "Your Kimi session expired. Re-connect this provider from the sidebar.",
    );
  });

  test("other kimi refresh failures surface the error description", async () => {
    const store = new InMemoryCredentialStore();
    await storeTokens(store, "kimi", {
      accessToken: "a",
      refreshToken: "r",
      expiresAt: NOW,
    });
    const fetchFn = fakeFetch(() =>
      Response.json(
        { error: "server_error", error_description: "Try later" },
        { status: 500 },
      ),
    );
    await expect(
      validAccessToken(store, "kimi", "kimi", fetchFn, now),
    ).rejects.toThrow("Nexus could not complete the Kimi sign-in: Try later");
  });
});
