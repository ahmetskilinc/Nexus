import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppState, ProviderKind, ProviderProfile } from "@nexus/protocol";
import { app } from "electron";

const EMPTY_STATE: AppState = { version: 1, providers: [], sessions: [] };

/// Top-level AppState keys allowed to reach disk. Anything else the renderer
/// sends is dropped, so a compromised renderer can't smuggle unexpected (e.g.
/// secret-bearing) fields into the plaintext state.json.
const ALLOWED_KEYS = new Set<keyof AppState>([
  "version",
  "workspacePath",
  "providers",
  "selectedProviderId",
  "selectedModel",
  "selectedEffort",
  "sessions",
  "currentSessionId",
  "sideSessionId",
  "sidePosition",
  "splitRatio",
  "theme",
  "reduceMotion",
  "webAccess",
  "commandEnvironment",
  "terminalShell",
  "maxToolRounds",
  "maxRunSeconds",
  "maxRunCostUsd",
  "mcpServers",
  "customInstructions",
  "windowBounds",
]);

const PROVIDER_KINDS = new Set<ProviderKind>(["OpenAI", "Anthropic", "Kimi"]);

/// Reshapes provider profiles to exactly their known fields. Provider secrets
/// live only in the OS keychain (via the runtime credential store), never here;
/// this guarantees nothing else attached to a profile is persisted.
function sanitizeProviders(value: unknown): ProviderProfile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ProviderProfile[] => {
    if (typeof item !== "object" || item === null) return [];
    const { id, name, kind, authentication } = item as Record<string, unknown>;
    if (
      typeof id !== "string" ||
      typeof name !== "string" ||
      !PROVIDER_KINDS.has(kind as ProviderKind) ||
      (authentication !== "api_key" && authentication !== "oauth")
    )
      return [];
    return [{ id, name, kind: kind as ProviderKind, authentication }];
  });
}

/// Coerces renderer- or disk-supplied data into a well-formed AppState: drops
/// unknown top-level keys, pins the version, and strictly reshapes providers.
function sanitizeState(value: unknown): AppState {
  const input =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const clean: Record<string, unknown> = {};
  for (const key of Object.keys(input)) {
    if (ALLOWED_KEYS.has(key as keyof AppState)) clean[key] = input[key];
  }
  return {
    ...EMPTY_STATE,
    ...(clean as Partial<AppState>),
    version: 1,
    providers: sanitizeProviders(input.providers),
    sessions: Array.isArray(input.sessions) ? input.sessions : [],
  };
}

export class Store {
  private state: AppState = { ...EMPTY_STATE };
  private writeQueue = Promise.resolve();

  async load() {
    try {
      const contents = await readFile(this.path, "utf8");
      this.state = sanitizeState(JSON.parse(contents));
    } catch {
      this.state = { ...EMPTY_STATE };
    }
    return this.snapshot();
  }

  snapshot() {
    return structuredClone(this.state);
  }

  async save(next: AppState) {
    this.state = sanitizeState(next);
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(path.dirname(this.path), { recursive: true });
      const temporary = `${this.path}.tmp`;
      await writeFile(temporary, JSON.stringify(this.state, null, 2), "utf8");
      await rename(temporary, this.path);
    });
    await this.writeQueue;
    return this.snapshot();
  }

  private get path() {
    return path.join(app.getPath("userData"), "state.json");
  }
}
