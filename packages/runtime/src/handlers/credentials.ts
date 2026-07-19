import { type CredentialStore, oauthAccount } from "@nexus/auth";
import { stringParam } from "../params";

export async function handleCredentialsSet(
  params: unknown,
  store: CredentialStore,
) {
  const providerId = stringParam(params, "providerId");
  const value = stringParam(params, "value");
  await store.set(providerId, value);
  return {};
}

/// Deletes both the API-key entry and the provider's OAuth token bundle.
export async function handleCredentialsDelete(
  params: unknown,
  store: CredentialStore,
) {
  const providerId = stringParam(params, "providerId");
  await store.delete(providerId);
  await store.delete(oauthAccount(providerId));
  return {};
}
