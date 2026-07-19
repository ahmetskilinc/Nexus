import { beforeAll, describe, expect, test } from "bun:test";
import {
  anthropicThinkingTier,
  DEFAULT_EFFORT,
  effortLevels,
  openaiEffortValue,
  parseEffort,
  supportsEffort,
} from "./capabilities";
import { configureModelsDevCache } from "./models-dev";

beforeAll(() => {
  // Hermetic: ignore any real disk cache; use the bundled snapshot.
  configureModelsDevCache(null);
});

describe("capabilities", () => {
  test("effort defaults to medium and parses wire values", () => {
    expect(DEFAULT_EFFORT).toBe("medium");
    expect(parseEffort("bogus")).toBeUndefined();
    expect(parseEffort("xhigh")).toBe("xhigh");
  });

  test("openai reasoning models detected", () => {
    expect(supportsEffort("OpenAI", "gpt-5.2-codex")).toBe(true);
    expect(supportsEffort("OpenAI", "gpt-5.1")).toBe(true);
    expect(supportsEffort("OpenAI", "o3")).toBe(true);
    expect(supportsEffort("OpenAI", "gpt-4o")).toBe(false);
  });

  test("anthropic thinking families detected", () => {
    expect(supportsEffort("Anthropic", "claude-sonnet-4-5")).toBe(true);
    expect(supportsEffort("Anthropic", "claude-opus-4-5")).toBe(true);
    expect(supportsEffort("Anthropic", "claude-3-5-sonnet")).toBe(false);
  });

  test("kimi never exposes effort control", () => {
    expect(supportsEffort("Kimi", "kimi-k2-thinking")).toBe(false);
    expect(effortLevels("Kimi", "kimi-k2-thinking")).toEqual([]);
  });

  test("openai effort clamps per model", () => {
    // Values come from the catalog. gpt-5.2-codex accepts xhigh; gpt-5.1
    // (none/low/medium/high) does not, so xhigh clamps to high.
    expect(openaiEffortValue("gpt-5.2-codex", "xhigh")).toBe("xhigh");
    expect(openaiEffortValue("gpt-5.1", "xhigh")).toBe("high");
    // gpt-5 accepts minimal; gpt-5.1 does not, so minimal clamps up to low
    // (never down to "none", which would disable reasoning).
    expect(openaiEffortValue("gpt-5", "minimal")).toBe("minimal");
    expect(openaiEffortValue("gpt-5.1", "minimal")).toBe("low");
    // o3 (low/medium/high) clamps minimal up to low.
    expect(openaiEffortValue("o3", "minimal")).toBe("low");
  });

  test("effort levels track catalog values", () => {
    expect(effortLevels("OpenAI", "gpt-5.2-codex")).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    // gpt-5.1 exposes none/low/medium/high; `none` is dropped from picker.
    expect(effortLevels("OpenAI", "gpt-5.1")).toEqual([
      "low",
      "medium",
      "high",
    ]);
    expect(effortLevels("OpenAI", "gpt-4o")).toEqual([]);
  });

  test("unknown model falls back to heuristics", () => {
    expect(supportsEffort("OpenAI", "o5-custom-ft")).toBe(true);
    expect(openaiEffortValue("o5-custom-ft", "minimal")).toBe("low");
  });

  test("anthropic tiers keep the api invariant", () => {
    expect(anthropicThinkingTier("minimal")).toBeUndefined();
    for (const effort of ["low", "medium", "high", "xhigh"] as const) {
      const tier = anthropicThinkingTier(effort);
      if (!tier) throw new Error("expected a tier");
      const [budget, max] = tier;
      expect(budget).toBeGreaterThanOrEqual(1024);
      expect(max).toBeGreaterThan(budget);
    }
  });
});
