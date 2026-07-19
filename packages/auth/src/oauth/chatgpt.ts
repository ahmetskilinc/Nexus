import {
  asNumber,
  asRecord,
  asString,
  type RuntimeEmitter,
  RuntimeError,
} from "@nexus/protocol";
import type { CredentialStore } from "../credential-store";
import {
  createPkce,
  formEncode,
  percentEncode,
  randomState,
} from "../encoding";
import { decodeJwtClaims } from "../jwt";
import { storeTokens, type Tokens } from "../tokens";
import { bindLoopback } from "./loopback";

/// Codex-CLI-style ChatGPT sign-in: PKCE against auth.openai.com with a fixed
/// localhost:1455 callback (the port is injectable only for tests).
export const CHATGPT_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const CHATGPT_ISSUER = "https://auth.openai.com";

export interface SignInChatGptDeps {
  store: CredentialStore;
  emitter: RuntimeEmitter;
  /// Tokens are stored under `oauthAccount(providerId)`.
  providerId: string;
  fetchFn?: typeof fetch;
  port?: number;
  openTimeoutMs?: number;
}

export async function signInChatGpt(
  deps: SignInChatGptDeps,
): Promise<{ email?: string; accountId?: string }> {
  const fetchFn = deps.fetchFn ?? fetch;
  const { verifier, challenge } = createPkce();
  const state = randomState();

  /// Bind before emitting the URL so the browser can never race the listener.
  const listener = await bindLoopback(deps.port);
  try {
    const redirectUri = `http://localhost:${listener.port}/auth/callback`;
    const authorizeUrl =
      `${CHATGPT_ISSUER}/oauth/authorize?response_type=code` +
      `&client_id=${percentEncode(CHATGPT_CLIENT_ID)}` +
      `&redirect_uri=${percentEncode(redirectUri)}` +
      `&scope=${percentEncode("openid profile email offline_access")}` +
      `&code_challenge=${percentEncode(challenge)}` +
      "&code_challenge_method=S256&id_token_add_organizations=true" +
      `&codex_cli_simplified_flow=true&state=${percentEncode(state)}` +
      "&originator=codex_cli_rs";
    deps.emitter.emit({ type: "authorize_url", url: authorizeUrl });

    const code = await listener.waitForCode(state, deps.openTimeoutMs);
    const tokens = await exchange(fetchFn, code, verifier, redirectUri);
    await storeTokens(deps.store, deps.providerId, tokens);
    return { email: tokens.email, accountId: tokens.accountId };
  } finally {
    await listener.close();
  }
}

async function exchange(
  fetchFn: typeof fetch,
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<Tokens> {
  const response = await fetchFn(`${CHATGPT_ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formEncode([
      ["grant_type", "authorization_code"],
      ["code", code],
      ["redirect_uri", redirectUri],
      ["client_id", CHATGPT_CLIENT_ID],
      ["code_verifier", verifier],
    ]),
  });
  const text = await response.text();
  if (!response.ok) {
    throw RuntimeError.msg(
      `Nexus could not complete the ChatGPT sign-in: ${text}`,
    );
  }
  const malformed = () =>
    RuntimeError.msg(
      "Nexus could not complete the ChatGPT sign-in: The token response was malformed.",
    );
  const object = parseRecord(text);
  if (object === undefined) throw malformed();
  const idToken = asString(object.id_token);
  const accessToken = asString(object.access_token);
  const refreshToken = asString(object.refresh_token);
  if (
    idToken === undefined ||
    accessToken === undefined ||
    refreshToken === undefined
  ) {
    throw malformed();
  }
  return buildTokens(idToken, accessToken, refreshToken);
}

/// Rejections that mean the session is gone for good — refreshing again can
/// never succeed, so send the user back to sign-in instead of retrying.
const PERMANENT_FAILURES = [
  "refresh_token_expired",
  "refresh_token_reused",
  "refresh_token_invalidated",
] as const;

export async function refreshChatGpt(
  tokens: Tokens,
  fetchFn: typeof fetch = fetch,
): Promise<Tokens> {
  const sessionExpired = () =>
    RuntimeError.msg(
      "Your ChatGPT session expired. Re-connect this provider from the sidebar.",
    );
  /// The ChatGPT flow always stores a refresh token; its absence means the
  /// stored session is unusable, which is the same permanent condition.
  if (tokens.refreshToken === undefined) throw sessionExpired();
  const response = await fetchFn(`${CHATGPT_ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CHATGPT_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    if (PERMANENT_FAILURES.some((failure) => text.includes(failure)))
      throw sessionExpired();
    throw RuntimeError.msg(
      `Nexus could not complete the ChatGPT sign-in: ${text}`,
    );
  }
  const object = parseRecord(text);
  const accessToken =
    object === undefined ? undefined : asString(object.access_token);
  if (object === undefined || accessToken === undefined) {
    throw RuntimeError.msg(
      "Nexus could not complete the ChatGPT sign-in: The refresh response was malformed.",
    );
  }
  /// Rotation semantics: a refresh response may omit id_token/refresh_token,
  /// in which case the previous ones stay valid and are carried forward.
  return buildTokens(
    asString(object.id_token) ?? tokens.idToken,
    accessToken,
    asString(object.refresh_token) ?? tokens.refreshToken,
  );
}

/// Derives the stored token record from the raw JWTs. The account id lives in
/// the nested `https://api.openai.com/auth` claim (access token first, then id
/// token), falling back to a top-level `chatgpt_account_id` in either token;
/// email comes from the id token; expiry from the access token's `exp` (JWT
/// seconds, stored as Unix milliseconds).
export function buildTokens(
  idToken: string | undefined,
  accessToken: string,
  refreshToken: string,
): Tokens {
  const idClaims = decodeJwtClaims(idToken ?? "");
  const accessClaims = decodeJwtClaims(accessToken);
  const auth =
    asRecord(accessClaims["https://api.openai.com/auth"]) ??
    asRecord(idClaims["https://api.openai.com/auth"]);
  const accountId =
    asString(auth?.chatgpt_account_id) ??
    asString(accessClaims.chatgpt_account_id) ??
    asString(idClaims.chatgpt_account_id);
  const exp = asNumber(accessClaims.exp);
  return {
    idToken,
    accessToken,
    refreshToken,
    accountId,
    email: asString(idClaims.email),
    expiresAt: exp === undefined ? undefined : exp * 1000,
  };
}

function parseRecord(text: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return undefined;
  }
}
