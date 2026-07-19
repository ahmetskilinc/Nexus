import { randomUUID } from "node:crypto";
import {
  asNumber,
  asRecord,
  asString,
  type RuntimeEmitter,
  RuntimeError,
} from "@nexus/protocol";
import type { CredentialStore } from "../credential-store";
import { formEncode } from "../encoding";
import { storeTokens, type Tokens } from "../tokens";

/// Kimi (Moonshot) subscription sign-in: the RFC 8628 device-authorization
/// flow kimi-cli's `/login` uses, against auth.kimi.com. Third-party status
/// matches the Codex client id — a publicly known client id, not a sanctioned
/// integration.
///
/// kimi-cli's public OAuth client id (no registration needed).
export const KIMI_CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";
export const KIMI_AUTH_HOST = "https://auth.kimi.com";
/// The kimi-cli release whose request fingerprint we mirror.
const CLI_VERSION = "1.9.0";
const DEVICE_ID_ACCOUNT = "kimi.device_id";

/// Maps Node's arch names onto the values Rust's `std::env::consts::ARCH`
/// reported, so the device fingerprint stays identical across the rewrite.
function deviceModel(): string {
  switch (process.arch) {
    case "arm64":
      return "aarch64";
    case "x64":
      return "x86_64";
    case "ia32":
      return "x86";
    default:
      return process.arch;
  }
}

/// Same for `std::env::consts::OS` ("macos"/"windows"/"linux").
function osVersion(): string {
  switch (process.platform) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    default:
      return process.platform;
  }
}

/// The X-Msh-* device fingerprint the Kimi endpoints expect on both the OAuth
/// calls and every coding-API request. ASCII only.
export async function kimiDeviceHeaders(
  store: CredentialStore,
): Promise<Record<string, string>> {
  return {
    "User-Agent": `KimiCLI/${CLI_VERSION}`,
    "X-Msh-Platform": "kimi_cli",
    "X-Msh-Version": CLI_VERSION,
    "X-Msh-Device-Name": "Nexus",
    "X-Msh-Device-Model": deviceModel(),
    "X-Msh-Os-Version": osVersion(),
    "X-Msh-Device-Id": await deviceId(store),
  };
}

/// A stable per-install device id, minted once and kept in the credential
/// store. Read and write failures are best-effort (a fresh id is minted), as
/// in the Rust runtime.
async function deviceId(store: CredentialStore): Promise<string> {
  let existing: string | undefined;
  try {
    existing = await store.get(DEVICE_ID_ACCOUNT);
  } catch {
    existing = undefined;
  }
  if (existing !== undefined) return existing;
  const id = randomUUID();
  try {
    await store.set(DEVICE_ID_ACCOUNT, id);
  } catch {
    /* best-effort */
  }
  return id;
}

export interface SignInKimiDeps {
  store: CredentialStore;
  emitter: RuntimeEmitter;
  /// Tokens are stored under `oauthAccount(providerId)`.
  providerId: string;
  fetchFn?: typeof fetch;
  /// Test hook: overrides every poll sleep (the RFC interval math still runs).
  pollIntervalMsOverride?: number;
  now?: () => number;
}

export async function signInKimi(
  deps: SignInKimiDeps,
): Promise<{ email?: string; accountId?: string }> {
  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ?? Date.now;
  const { object: grant } = await postForm(
    fetchFn,
    deps.store,
    `${KIMI_AUTH_HOST}/api/oauth/device_authorization`,
    [["client_id", KIMI_CLIENT_ID]],
  );
  const deviceCode = asString(grant.device_code);
  const url =
    asString(grant.verification_uri_complete) ??
    asString(grant.verification_uri);
  if (deviceCode === undefined || url === undefined) {
    throw failure("The device-authorization response was malformed.");
  }
  /// The desktop opens this like any authorize URL; the user confirms the
  /// code in the browser while we poll for the grant below.
  const userCode = asString(grant.user_code);
  deps.emitter.emit(
    userCode === undefined
      ? { type: "authorize_url", url }
      : { type: "authorize_url", url, userCode },
  );

  let intervalSeconds = Math.max(asNumber(grant.interval) ?? 5, 1);
  const expiresIn = Math.min(asNumber(grant.expires_in) ?? 300, 600);
  const deadline = now() + expiresIn * 1000;
  for (;;) {
    await sleep(deps.pollIntervalMsOverride ?? intervalSeconds * 1000);
    if (now() >= deadline)
      throw RuntimeError.msg("Sign-in timed out. Try again.");
    const { ok, object } = await postForm(
      fetchFn,
      deps.store,
      `${KIMI_AUTH_HOST}/api/oauth/token`,
      [
        ["grant_type", "urn:ietf:params:oauth:grant-type:device_code"],
        ["device_code", deviceCode],
        ["client_id", KIMI_CLIENT_ID],
      ],
    );
    if (ok) {
      const tokens = parseKimiTokens(object, undefined, now);
      await storeTokens(deps.store, deps.providerId, tokens);
      return { email: tokens.email, accountId: tokens.accountId };
    }
    const error = asString(object.error);
    if (error === "authorization_pending") continue;
    if (error === "slow_down") {
      intervalSeconds += 5;
      continue;
    }
    throw failure(
      asString(object.error_description) ??
        error ??
        "The token response was malformed.",
    );
  }
}

export async function refreshKimi(
  store: CredentialStore,
  tokens: Tokens,
  fetchFn: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<Tokens> {
  const sessionExpired = () =>
    RuntimeError.msg(
      "Your Kimi session expired. Re-connect this provider from the sidebar.",
    );
  if (tokens.refreshToken === undefined) throw sessionExpired();
  const { ok, object } = await postForm(
    fetchFn,
    store,
    `${KIMI_AUTH_HOST}/api/oauth/token`,
    [
      ["grant_type", "refresh_token"],
      ["refresh_token", tokens.refreshToken],
      ["client_id", KIMI_CLIENT_ID],
    ],
  );
  if (!ok) {
    /// Kimi refresh tokens last ~30 days; any invalid_grant here means the
    /// session is gone for good, so send the user back to sign-in.
    if (asString(object.error) === "invalid_grant") throw sessionExpired();
    throw failure(
      asString(object.error_description) ??
        asString(object.error) ??
        "The refresh response was malformed.",
    );
  }
  return parseKimiTokens(object, tokens, now);
}

/// Reads a token response into our `Tokens` shape. Kimi has no id token or
/// account id; the expiry comes from `expires_in` (~15 minutes).
function parseKimiTokens(
  object: Record<string, unknown>,
  previous: Tokens | undefined,
  now: () => number,
): Tokens {
  const accessToken = asString(object.access_token);
  if (accessToken === undefined)
    throw failure("The token response was malformed.");
  const refreshToken = asString(object.refresh_token) ?? previous?.refreshToken;
  if (refreshToken === undefined)
    throw failure("The token response was malformed.");
  const expiresIn = asNumber(object.expires_in);
  return {
    accessToken,
    refreshToken,
    email: previous?.email,
    expiresAt: expiresIn === undefined ? undefined : now() + expiresIn * 1000,
  };
}

/// POSTs a form to the auth host with the device fingerprint and returns the
/// ok flag plus parsed JSON body (parsed even on 4xx — OAuth errors ride in
/// the body; non-JSON bodies become an empty object).
async function postForm(
  fetchFn: typeof fetch,
  store: CredentialStore,
  url: string,
  fields: readonly (readonly [string, string])[],
): Promise<{ ok: boolean; object: Record<string, unknown> }> {
  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(await kimiDeviceHeaders(store)),
    },
    body: formEncode(fields),
  });
  const text = await response.text();
  let object: Record<string, unknown> = {};
  try {
    object = asRecord(JSON.parse(text)) ?? {};
  } catch {
    object = {};
  }
  return { ok: response.ok, object };
}

function failure(detail: string): RuntimeError {
  return RuntimeError.msg(
    `Nexus could not complete the Kimi sign-in: ${detail}`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
