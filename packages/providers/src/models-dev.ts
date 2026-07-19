/// The model catalog, sourced from https://models.dev — a community database
/// of model metadata (context limits, pricing, capability flags). It is the
/// single source of truth for what a model *is*; name-regex heuristics survive
/// only as a fallback for models the catalog doesn't know.
///
/// A snapshot ships inside the bundle so the catalog works offline and on
/// first run; a background refresh pulls the live api.json into a disk cache,
/// filtered to the providers Nexus supports.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  asArray,
  asBoolean,
  asNumber,
  asRecord,
  asString,
  get,
} from "@nexus/protocol";
import snapshot from "./models-dev-snapshot.json";
import type { AuthMethod, ProviderKind } from "./types";

const API_URL = "https://models.dev/api.json";
/// Skip a network refresh if the disk cache is younger than this.
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
/// The providers we mirror from the full feed. Kimi maps to two upstream keys:
/// `moonshotai` (open-platform API keys) and `kimi-for-coding` (OAuth coding).
const PROVIDERS = [
  "openai",
  "anthropic",
  "moonshotai",
  "kimi-for-coding",
] as const;

export type CatalogModel = {
  id: string;
  name: string;
  reasoning: boolean;
  toolCall: boolean;
  releaseDate?: string;
  status?: string;
  context?: number;
  maxOutput?: number;
  costInput?: number;
  costOutput?: number;
  outputModalities?: string[];
  /// Accepted `effort`-type reasoning values (raw models.dev strings), empty
  /// when the model has no effort control.
  effortValues: string[];
};

type Catalog = Map<string, Map<string, CatalogModel>>;

function parseModel(raw: unknown): CatalogModel | undefined {
  const id = asString(get(raw, "id"));
  if (!id) return undefined;
  const options = asArray(get(raw, "reasoning_options")) ?? [];
  const effortValues =
    options
      .map((option) =>
        asString(get(option, "type")) === "effort"
          ? (asArray(get(option, "values")) ?? []).flatMap((value) => {
              const text = asString(value);
              return text ? [text] : [];
            })
          : undefined,
      )
      .find((values) => values !== undefined) ?? [];
  const modalities = asArray(get(raw, "modalities", "output"))?.flatMap(
    (value) => {
      const text = asString(value);
      return text ? [text] : [];
    },
  );
  return {
    id,
    name: asString(get(raw, "name")) ?? "",
    reasoning: asBoolean(get(raw, "reasoning")) ?? false,
    toolCall: asBoolean(get(raw, "tool_call")) ?? false,
    releaseDate: asString(get(raw, "release_date")),
    status: asString(get(raw, "status")),
    context: asNumber(get(raw, "limit", "context")),
    maxOutput: asNumber(get(raw, "limit", "output")),
    costInput: asNumber(get(raw, "cost", "input")),
    costOutput: asNumber(get(raw, "cost", "output")),
    outputModalities: modalities,
    effortValues,
  };
}

/// Parses raw catalog JSON; undefined when any supported provider is missing
/// (a cache written by an older build predating a provider must not win).
function parseCatalog(raw: unknown): Catalog | undefined {
  const record = asRecord(raw);
  if (!record) return undefined;
  const catalog: Catalog = new Map();
  for (const key of PROVIDERS) {
    const provider = asRecord(record[key]);
    if (!provider) return undefined;
    const models = new Map<string, CatalogModel>();
    for (const [id, value] of Object.entries(asRecord(provider.models) ?? {})) {
      const model = parseModel(value);
      if (model) models.set(id, model);
    }
    catalog.set(key, models);
  }
  return catalog;
}

let current: Catalog | undefined;
let cachePathOverride: string | null | undefined;

/// Tests point the disk cache somewhere hermetic (or null to disable it).
export function configureModelsDevCache(pathOrNull: string | null) {
  cachePathOverride = pathOrNull;
  current = undefined;
}

function cachePath(): string | undefined {
  if (cachePathOverride !== undefined) return cachePathOverride ?? undefined;
  const home = process.env.HOME;
  if (process.platform === "darwin")
    return home
      ? path.join(home, "Library/Caches", "dev.nexus.app", "models.json")
      : undefined;
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA;
    return base ? path.join(base, "dev.nexus.app", "models.json") : undefined;
  }
  const base =
    process.env.XDG_CACHE_HOME ?? (home && path.join(home, ".cache"));
  return base ? path.join(base, "dev.nexus.app", "models.json") : undefined;
}

function loadDisk(): Catalog | undefined {
  const file = cachePath();
  if (!file || !existsSync(file)) return undefined;
  try {
    return parseCatalog(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return undefined;
  }
}

function bundledCatalog(): Catalog {
  const parsed = parseCatalog(snapshot);
  if (!parsed) throw new Error("bundled models.dev snapshot must parse");
  return parsed;
}

/// The best catalog available right now: the disk cache if present and
/// parseable, otherwise the bundled snapshot.
export function catalog(): Catalog {
  current ??= loadDisk() ?? bundledCatalog();
  return current;
}

/// Wire provider key used by models.dev. Kimi's reachable model set depends on
/// the credential: API keys hit the open platform (`moonshotai`), OAuth tokens
/// hit the subscription coding endpoint (`kimi-for-coding`).
export function providerKey(kind: ProviderKind, auth: AuthMethod): string {
  if (kind === "OpenAI") return "openai";
  if (kind === "Anthropic") return "anthropic";
  return auth === "api_key" ? "moonshotai" : "kimi-for-coding";
}

/// Looks up one model's metadata by provider and id (exact match). Metadata is
/// auth-independent, so Kimi checks both of its upstream catalogs.
export function lookup(
  kind: ProviderKind,
  id: string,
): CatalogModel | undefined {
  const keys = [providerKey(kind, "api_key")];
  if (kind === "Kimi") keys.push(providerKey(kind, "oauth"));
  for (const key of keys) {
    const model = catalog().get(key)?.get(id);
    if (model) return model;
  }
  return undefined;
}

/// The catalog's own list of a provider's usable text models, newest first —
/// the offline fallback shown before (or instead of) a live provider fetch.
export function providerModels(kind: ProviderKind, auth: AuthMethod): string[] {
  const provider = catalog().get(providerKey(kind, auth));
  if (!provider) return [];
  const models = [...provider.values()].filter(
    (model) =>
      model.toolCall &&
      model.status !== "deprecated" &&
      (model.outputModalities?.includes("text") ?? true),
  );
  // Newest first by release date; ids with no date sink to the bottom.
  models.sort((a, b) => {
    const byDate = (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "");
    return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
  });
  return models.map((model) => model.id);
}

function cacheIsFresh(): boolean {
  const file = cachePath();
  if (!file || loadDisk() === undefined) return false;
  try {
    return Date.now() - statSync(file).mtimeMs < CACHE_TTL_MS;
  } catch {
    return false;
  }
}

/// Fetches the live catalog and updates the in-memory + disk copies. A no-op
/// when the cache is still fresh or the network is unavailable, so callers can
/// kick this off unconditionally at startup. The disk cache stores the raw
/// upstream JSON (filtered to our providers), identical in shape to the
/// bundled snapshot.
export async function refresh(fetchFn: typeof fetch = fetch): Promise<void> {
  if (cacheIsFresh()) return;
  let full: unknown;
  try {
    const response = await fetchFn(API_URL, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return;
    full = await response.json();
  } catch {
    return;
  }
  const record = asRecord(full);
  if (!record) return;
  const filtered: Record<string, unknown> = {};
  for (const key of PROVIDERS) {
    if (record[key] !== undefined) filtered[key] = record[key];
  }
  if (Object.keys(filtered).length === 0) return;
  // Validate the feed parses into our catalog before trusting it; a shape
  // change upstream leaves the previous cache/snapshot in place.
  const parsed = parseCatalog(filtered);
  if (!parsed) return;
  writeDisk(JSON.stringify(filtered));
  current = parsed;
}

/// Temp file + rename so a crash mid-write can never leave a truncated cache.
function writeDisk(json: string) {
  const file = cachePath();
  if (!file) return;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    writeFileSync(temp, json);
    renameSync(temp, file);
  } catch {
    // Cache writes are best-effort.
  }
}
