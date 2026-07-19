import { asNumber, asString, RuntimeError } from "@nexus/protocol";
import { type CredentialStore, oauthAccount } from "./credential-store";
import { refreshChatGpt } from "./oauth/chatgpt";
import { refreshKimi } from "./oauth/kimi";

/// Stored OAuth tokens. DELIBERATE format break from the Rust/Swift runtime:
/// the encrypted-file store starts empty (nothing migrates from the keychain),
/// so the Swift-compat quirks are dropped — plain camelCase field names
/// (`accountId`, not `accountID`) and `expiresAt` in UNIX MILLISECONDS instead
/// of `accessTokenExpiry` seconds-since-the-Apple-epoch. `idToken` and
/// `refreshToken` are optional because Kimi issues neither an id token nor
/// (in theory) always a refresh token.
export interface Tokens {
  idToken?: string;
  accessToken: string;
  refreshToken?: string;
  accountId?: string;
  email?: string;
  /// Milliseconds since the Unix epoch.
  expiresAt?: number;
}

/// Refresh when the access token has less than this long to live (the Rust
/// runtime's 300-second margin).
export const REFRESH_MARGIN_MS = 300_000;

export async function storeTokens(
  store: CredentialStore,
  providerId: string,
  tokens: Tokens,
): Promise<void> {
  await store.set(oauthAccount(providerId), JSON.stringify(tokens));
}

/// Undefined when the account is missing or its JSON is unreadable — the same
/// "treat as signed out" posture as the Rust `load`.
export async function loadTokens(
  store: CredentialStore,
  providerId: string,
): Promise<Tokens | undefined> {
  const json = await store.get(oauthAccount(providerId));
  if (json === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return undefined;
  const record = parsed as Record<string, unknown>;
  const accessToken = asString(record.accessToken);
  if (accessToken === undefined) return undefined;
  return {
    idToken: asString(record.idToken),
    accessToken,
    refreshToken: asString(record.refreshToken),
    accountId: asString(record.accountId),
    email: asString(record.email),
    expiresAt: asNumber(record.expiresAt),
  };
}

/// Loads the provider's tokens, refreshing (and re-storing) them first when
/// the access token expires within the margin. The returned tokens carry the
/// current `accessToken` plus the `accountId` the run loop puts in headers.
export async function validAccessToken(
  store: CredentialStore,
  providerId: string,
  kind: "openai" | "kimi",
  fetchFn: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<Tokens> {
  let tokens = await loadTokens(store, providerId);
  if (tokens === undefined) {
    throw RuntimeError.msg(
      "This provider has no active session. Re-connect it from the sidebar.",
    );
  }
  if (
    tokens.expiresAt !== undefined &&
    tokens.expiresAt < now() + REFRESH_MARGIN_MS
  ) {
    tokens =
      kind === "kimi"
        ? await refreshKimi(store, tokens, fetchFn, now)
        : await refreshChatGpt(tokens, fetchFn);
    await storeTokens(store, providerId, tokens);
  }
  return tokens;
}
