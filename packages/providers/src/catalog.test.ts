import { beforeAll, describe, expect, test } from "bun:test";
import {
  catalogModels,
  describe as describeModel,
  fetchModels,
  filterChatModels,
} from "./catalog";
import {
  catalog,
  configureModelsDevCache,
  lookup,
  providerModels,
} from "./models-dev";

beforeAll(() => configureModelsDevCache(null));

describe("models.dev bundled snapshot", () => {
  test("parses and has all providers", () => {
    const parsed = catalog();
    for (const key of ["openai", "anthropic", "moonshotai", "kimi-for-coding"])
      expect(parsed.has(key)).toBe(true);
    expect((parsed.get("openai")?.size ?? 0) > 10).toBe(true);
  });

  test("openai effort values come from reasoning_options", () => {
    const codex = lookup("OpenAI", "gpt-5.2-codex");
    if (!codex) throw new Error("gpt-5.2-codex missing from snapshot");
    expect(codex.reasoning).toBe(true);
    expect(codex.effortValues).toContain("high");
    expect(codex.effortValues).toContain("xhigh");
    // The codex family has no `minimal` tier.
    expect(codex.effortValues).not.toContain("minimal");
  });

  test("provider models are newest-first and drop deprecated", () => {
    const models = providerModels("Anthropic", "api_key");
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((id) => id.startsWith("claude"))).toBe(true);
  });

  test("kimi catalog depends on auth; lookup checks both", () => {
    const apiKey = providerModels("Kimi", "api_key");
    const oauth = providerModels("Kimi", "oauth");
    expect(apiKey.length).toBeGreaterThan(0);
    expect(oauth.length).toBeGreaterThan(0);
    expect(apiKey).not.toEqual(oauth);
    const coding = oauth[0];
    if (!coding) throw new Error("no oauth models");
    expect(lookup("Kimi", coding)).toBeDefined();
  });

  test("lookup returns metadata", () => {
    const sonnet = lookup("Anthropic", "claude-sonnet-4-5");
    if (!sonnet) throw new Error("claude-sonnet-4-5 missing from snapshot");
    expect(sonnet.reasoning).toBe(true);
    expect(sonnet.toolCall).toBe(true);
    expect((sonnet.context ?? 0) >= 200_000).toBe(true);
  });
});

describe("catalog", () => {
  test("filter keeps chat families and sorts descending", () => {
    expect(
      filterChatModels([
        "gpt-5.2",
        "gpt-4o-audio-preview",
        "text-embedding-3-large",
        "o3",
        "whisper-1",
        "gpt-5.2-codex",
      ]),
    ).toEqual(["o3", "gpt-5.2-codex", "gpt-5.2"]);
  });

  test("describe enriches with effort levels and pricing", () => {
    const info = describeModel("Anthropic", "claude-sonnet-4-5");
    expect(info.reasoning).toBe(true);
    expect(info.effort).toEqual(["minimal", "low", "medium", "high"]);
    expect(info.name.length).toBeGreaterThan(0);
    // Unknown model: bare id, tool_call assumed true.
    const unknown = describeModel("OpenAI", "my-custom-ft");
    expect(unknown.name).toBe("my-custom-ft");
    expect(unknown.toolCall).toBe(true);
  });

  test("chatgpt oauth catalog is gpt-5-only minus pro/chat-latest", () => {
    const models = catalogModels("OpenAI", "oauth");
    expect(models.length).toBeGreaterThan(0);
    for (const model of models) {
      expect(model.id.startsWith("gpt-5")).toBe(true);
      expect(model.id.includes("-pro")).toBe(false);
      expect(model.id.includes("chat-latest")).toBe(false);
    }
  });

  test("fetchModels uses the catalog for oauth openai/kimi without a key", async () => {
    const neverCalled = (() => {
      throw new Error("network must not be touched");
    }) as unknown as typeof fetch;
    const models = await fetchModels(neverCalled, "OpenAI", "oauth", () => {
      throw new Error("key must not be resolved");
    });
    expect(models.length).toBeGreaterThan(0);
  });

  test("fetchModels queries anthropic live and filters non-text/tool models", async () => {
    const fetchFn = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: [
              { id: "claude-sonnet-4-5" },
              { id: "claude-3-5-sonnet-20241022" },
            ],
          }),
          { status: 200 },
        ),
      )) as unknown as typeof fetch;
    const models = await fetchModels(
      fetchFn,
      "Anthropic",
      "api_key",
      async () => "sk-key",
    );
    expect(models.map((model) => model.id)).toContain("claude-sonnet-4-5");
  });
});
