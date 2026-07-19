import { describe, expect, test } from "bun:test";
import { collectingEmitter } from "@nexus/protocol";
import { InMemoryCredentialStore } from "../credential-store";
import { loadTokens } from "../tokens";
import { buildTokens, refreshChatGpt, signInChatGpt } from "./chatgpt";

function jwtOf(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
}

function fakeFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    handler(String(input), init ?? {})) as typeof fetch;
}

async function nextAuthorizeUrl(
  emitter: ReturnType<typeof collectingEmitter>,
): Promise<URL> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const event = emitter.events.find(
      (entry) => entry.type === "authorize_url",
    );
    if (event !== undefined && event.type === "authorize_url")
      return new URL(event.url);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("authorize_url was never emitted");
}

const ID_TOKEN = jwtOf({ email: "user@example.com" });
const ACCESS_TOKEN = jwtOf({
  exp: 1_893_456_000,
  "https://api.openai.com/auth": { chatgpt_account_id: "acc_123" },
});

describe("signInChatGpt", () => {
  /// The full flow: bind an ephemeral loopback port, emit the authorize URL,
  /// receive the browser redirect over a real socket, exchange the code
  /// against a fake fetch, and persist the tokens.
  test("completes end to end over a real loopback socket", async () => {
    const store = new InMemoryCredentialStore();
    const emitter = collectingEmitter();
    const exchanges: string[] = [];
    const fetchFn = fakeFetch((url, init) => {
      exchanges.push(`${url} ${String(init.body)}`);
      return Response.json({
        id_token: ID_TOKEN,
        access_token: ACCESS_TOKEN,
        refresh_token: "rt-1",
      });
    });
    const result = signInChatGpt({
      store,
      emitter,
      providerId: "openai",
      fetchFn,
      port: 0,
    });

    const authorizeUrl = await nextAuthorizeUrl(emitter);
    expect(authorizeUrl.origin).toBe("https://auth.openai.com");
    expect(authorizeUrl.pathname).toBe("/oauth/authorize");
    const params = authorizeUrl.searchParams;
    expect(params.get("response_type")).toBe("code");
    expect(params.get("client_id")).toBe("app_EMoamEEZ73f0CkXaXp7hrann");
    expect(params.get("scope")).toBe("openid profile email offline_access");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(params.get("id_token_add_organizations")).toBe("true");
    expect(params.get("codex_cli_simplified_flow")).toBe("true");
    expect(params.get("originator")).toBe("codex_cli_rs");
    const redirectUri = new URL(params.get("redirect_uri") as string);
    expect(redirectUri.pathname).toBe("/auth/callback");
    const state = params.get("state") as string;

    const callback = await fetch(
      `http://127.0.0.1:${redirectUri.port}/auth/callback?code=the-code&state=${encodeURIComponent(state)}`,
    );
    expect(callback.status).toBe(200);

    expect(await result).toEqual({
      email: "user@example.com",
      accountId: "acc_123",
    });
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]).toContain("https://auth.openai.com/oauth/token");
    expect(exchanges[0]).toContain("grant_type=authorization_code");
    expect(exchanges[0]).toContain("code=the-code");
    expect(exchanges[0]).toContain("code_verifier=");

    const stored = await loadTokens(store, "openai");
    expect(stored?.accessToken).toBe(ACCESS_TOKEN);
    expect(stored?.refreshToken).toBe("rt-1");
    expect(stored?.accountId).toBe("acc_123");
    /// JWT exp seconds → stored Unix milliseconds.
    expect(stored?.expiresAt).toBe(1_893_456_000_000);
  });

  test("a failed token exchange surfaces the response text", async () => {
    const store = new InMemoryCredentialStore();
    const emitter = collectingEmitter();
    const fetchFn = fakeFetch(() => new Response("boom", { status: 500 }));
    const result = signInChatGpt({
      store,
      emitter,
      providerId: "openai",
      fetchFn,
      port: 0,
    });
    /// A no-op catch marks the rejection handled before it fires; the real
    /// assertion re-awaits the promise below.
    result.catch(() => {});
    const authorizeUrl = await nextAuthorizeUrl(emitter);
    const redirectUri = new URL(
      authorizeUrl.searchParams.get("redirect_uri") as string,
    );
    const state = authorizeUrl.searchParams.get("state") as string;
    await fetch(
      `http://127.0.0.1:${redirectUri.port}/auth/callback?code=c&state=${encodeURIComponent(state)}`,
    );
    await expect(result).rejects.toThrow(
      "Nexus could not complete the ChatGPT sign-in: boom",
    );
    expect(await loadTokens(store, "openai")).toBeUndefined();
  });

  test("a malformed token response fails cleanly", async () => {
    const store = new InMemoryCredentialStore();
    const emitter = collectingEmitter();
    const fetchFn = fakeFetch(() => Response.json({ access_token: "a" }));
    const result = signInChatGpt({
      store,
      emitter,
      providerId: "openai",
      fetchFn,
      port: 0,
    });
    result.catch(() => {});
    const authorizeUrl = await nextAuthorizeUrl(emitter);
    const redirectUri = new URL(
      authorizeUrl.searchParams.get("redirect_uri") as string,
    );
    const state = authorizeUrl.searchParams.get("state") as string;
    await fetch(
      `http://127.0.0.1:${redirectUri.port}/auth/callback?code=c&state=${encodeURIComponent(state)}`,
    );
    await expect(result).rejects.toThrow(
      "Nexus could not complete the ChatGPT sign-in: The token response was malformed.",
    );
  });

  test("times out with the exact user-facing message", async () => {
    const store = new InMemoryCredentialStore();
    const emitter = collectingEmitter();
    await expect(
      signInChatGpt({
        store,
        emitter,
        providerId: "openai",
        fetchFn: fakeFetch(() => Response.json({})),
        port: 0,
        openTimeoutMs: 30,
      }),
    ).rejects.toThrow("Sign-in timed out. Try again.");
  });
});

describe("buildTokens", () => {
  test("prefers the nested auth claim from the access token", () => {
    const idToken = jwtOf({
      email: "id@example.com",
      "https://api.openai.com/auth": { chatgpt_account_id: "from-id" },
      chatgpt_account_id: "top-id",
    });
    const tokens = buildTokens(idToken, ACCESS_TOKEN, "rt");
    expect(tokens.accountId).toBe("acc_123");
    expect(tokens.email).toBe("id@example.com");
    expect(tokens.expiresAt).toBe(1_893_456_000_000);
  });

  test("falls back to the id token's nested auth claim, then top level", () => {
    const nestedId = jwtOf({
      "https://api.openai.com/auth": { chatgpt_account_id: "from-id" },
    });
    expect(buildTokens(nestedId, jwtOf({}), "rt").accountId).toBe("from-id");
    /// A nested auth claim that is not an object is ignored.
    const scalarAuth = jwtOf({
      "https://api.openai.com/auth": "nope",
      chatgpt_account_id: "top-access",
    });
    expect(buildTokens(jwtOf({}), scalarAuth, "rt").accountId).toBe(
      "top-access",
    );
    const topLevelId = jwtOf({ chatgpt_account_id: "top-id" });
    expect(buildTokens(topLevelId, jwtOf({}), "rt").accountId).toBe("top-id");
  });

  test("undecodable tokens leave the derived fields unset", () => {
    const tokens = buildTokens("garbage", "also-garbage", "rt");
    expect(tokens.accountId).toBeUndefined();
    expect(tokens.email).toBeUndefined();
    expect(tokens.expiresAt).toBeUndefined();
  });
});

describe("refreshChatGpt", () => {
  test("a full refresh response replaces every token", async () => {
    const newId = jwtOf({ email: "new@example.com" });
    const fetchFn = fakeFetch(() =>
      Response.json({
        id_token: newId,
        access_token: ACCESS_TOKEN,
        refresh_token: "rt-2",
      }),
    );
    const tokens = await refreshChatGpt(
      { idToken: "old-id", accessToken: "old", refreshToken: "rt-1" },
      fetchFn,
    );
    expect(tokens.idToken).toBe(newId);
    expect(tokens.refreshToken).toBe("rt-2");
    expect(tokens.email).toBe("new@example.com");
  });

  test("a stored session without a refresh token is permanently expired", async () => {
    await expect(
      refreshChatGpt(
        { accessToken: "a" },
        fakeFetch(() => {
          throw new Error("must not fetch");
        }),
      ),
    ).rejects.toThrow(
      "Your ChatGPT session expired. Re-connect this provider from the sidebar.",
    );
  });
});
