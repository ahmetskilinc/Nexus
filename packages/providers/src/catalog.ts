import type { ModelInfo } from "@nexus/protocol";
import { asArray, asString, get } from "@nexus/protocol";
import { effortLevels, supportsEffort } from "./capabilities";
import { KIMI_MODELS_ENDPOINT } from "./kimi";
import { lookup, providerModels } from "./models-dev";
import type { AuthMethod, ProviderKind } from "./types";
import { ANTHROPIC_VERSION, getJson } from "./types";

/// Enriches a raw model id with catalog metadata and capability detection so
/// the picker can show a display name, context window, cost, and the exact
/// reasoning-effort levels the model accepts — instead of a bare id.
export function describe(kind: ProviderKind, id: string): ModelInfo {
  const entry = lookup(kind, id);
  return {
    id,
    name: entry?.name || id,
    reasoning: supportsEffort(kind, id),
    effort: effortLevels(kind, id),
    context: entry?.context,
    maxOutput: entry?.maxOutput,
    costInput: entry?.costInput,
    costOutput: entry?.costOutput,
    toolCall: entry?.toolCall ?? true,
    releaseDate: entry?.releaseDate,
    status: entry?.status,
    modalities: entry?.outputModalities ?? ["text"],
  };
}

/// The catalog's own model list for a provider — shown before a live fetch
/// completes and whenever the network or credential is unavailable.
export function catalogModels(
  kind: ProviderKind,
  auth: AuthMethod,
): ModelInfo[] {
  return providerModels(kind, auth)
    .filter((id) => isUsable(kind, auth, id))
    .map((id) => describe(kind, id));
}

/// Which catalog models a credential can actually run. An API key reaches the
/// full catalog. A ChatGPT (OAuth) subscription runs the GPT-5 family through
/// the Codex backend — the whole line, not just `*-codex*` — but not the
/// `*-pro*` reasoning variants (the ChatGPT backend rejects those) nor the
/// `chat-latest` aliases.
function isUsable(kind: ProviderKind, auth: AuthMethod, id: string): boolean {
  if (kind === "OpenAI" && auth === "oauth")
    return (
      id.startsWith("gpt-5") &&
      !id.includes("-pro") &&
      !id.includes("chat-latest")
    );
  return true;
}

/// Queries the provider's own models endpoint for the live list of models the
/// credential can actually reach, then enriches each with catalog metadata.
/// `getApiKey` resolves the stored credential (and throws the store's error
/// when it is missing).
export async function fetchModels(
  fetchFn: typeof fetch,
  kind: ProviderKind,
  auth: AuthMethod,
  getApiKey: () => Promise<string>,
  signal?: AbortSignal,
): Promise<ModelInfo[]> {
  // OAuth backends have no reliable live model list: the codex/models
  // endpoint only advertises the few slugs the Codex CLI blesses, and Kimi's
  // coding endpoint model set is curated by models.dev. Use the catalog.
  if (auth === "oauth" && (kind === "OpenAI" || kind === "Kimi"))
    return catalogModels(kind, auth);
  const apiKey = await getApiKey();
  let modelIds: string[];
  if (kind === "Anthropic") {
    const object = await getJson(
      fetchFn,
      "https://api.anthropic.com/v1/models?limit=100",
      [
        ["x-api-key", apiKey],
        ["anthropic-version", ANTHROPIC_VERSION],
      ],
      signal,
    );
    modelIds = ids(get(object, "data"));
  } else if (kind === "OpenAI") {
    // OAuth is handled above, so this is always an API-key request.
    const object = await getJson(
      fetchFn,
      "https://api.openai.com/v1/models",
      [["Authorization", `Bearer ${apiKey}`]],
      signal,
    );
    modelIds = filterChatModels(ids(get(object, "data")));
  } else {
    // Moonshot's open platform lists models in the OpenAI response shape.
    const object = await getJson(
      fetchFn,
      KIMI_MODELS_ENDPOINT,
      [["Authorization", `Bearer ${apiKey}`]],
      signal,
    );
    modelIds = ids(get(object, "data")).sort((a, b) => b.localeCompare(a));
  }
  return modelIds
    .map((id) => describe(kind, id))
    .filter(
      (model) => model.toolCall && (model.modalities ?? []).includes("text"),
    );
}

function ids(array: unknown): string[] {
  return (asArray(array) ?? []).flatMap((item) => {
    const id = asString(get(item, "id"));
    return id !== undefined ? [id] : [];
  });
}

/// The OpenAI list mixes in embedding, audio, image, and speech models that
/// cannot drive a text agent loop and would just error on first turn; drop
/// those and keep everything else so the picker shows the full model catalog.
export function filterChatModels(modelIds: string[]): string[] {
  const excluded = [
    "audio",
    "realtime",
    "transcribe",
    "tts",
    "image",
    "embedding",
    "moderation",
    "dall-e",
    "whisper",
    "sora",
    "search",
  ];
  return modelIds
    .filter((id) => !excluded.some((fragment) => id.includes(fragment)))
    .sort((a, b) => b.localeCompare(a));
}
