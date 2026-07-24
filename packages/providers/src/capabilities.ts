/// Reasoning-effort capability detection and per-provider mapping.
///
/// The UI exposes a single unified "Effort" concept; each provider realizes it
/// differently (OpenAI `reasoning.effort`, Anthropic extended-thinking
/// budget). This module is the authoritative place that decides whether a
/// given model supports effort at all and how a unified level maps onto the
/// wire. Capabilities come from the models.dev catalog; name heuristics remain
/// only as a fallback for models absent from it. The runtime always re-checks
/// and clamps here so a stale renderer value can never produce an API error.
import type { Effort } from "@nexus/protocol";
import { lookup } from "./models-dev";
import type { ProviderKind } from "./types";

export const DEFAULT_EFFORT: Effort = "medium";

export function parseEffort(value: string): Effort | undefined {
  return value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
    ? value
    : undefined;
}

/// Position of a models.dev effort value on the shared scale, low → high.
/// Values we don't model (`none`, `max`) still rank so clamping can reach
/// them.
function rank(value: string): number {
  switch (value) {
    case "none":
      return 0;
    case "minimal":
      return 1;
    case "low":
      return 2;
    case "medium":
      return 3;
    case "high":
      return 4;
    case "xhigh":
      return 5;
    case "max":
      return 6;
    default:
      return 3;
  }
}

/// Maps a models.dev effort value onto the unified union (`none` has no
/// unified equivalent and is dropped from the picker; `max` folds into the
/// top level).
function effortFromValue(value: string): Effort | undefined {
  if (value === "max") return "xhigh";
  return parseEffort(value);
}

/// Clamps a desired level to the nearest value the model actually accepts,
/// breaking ties toward *more* reasoning so "minimal" never silently disables
/// it.
function clampTo(values: string[], effort: Effort): string {
  if (values.includes(effort)) return effort;
  const target = rank(effort);
  let best: string | undefined;
  for (const value of values) {
    if (best === undefined) {
      best = value;
      continue;
    }
    const byDistance =
      Math.abs(rank(value) - target) - Math.abs(rank(best) - target);
    if (byDistance < 0 || (byDistance === 0 && rank(value) > rank(best)))
      best = value;
  }
  return best ?? effort;
}

function isOSeries(model: string): boolean {
  return /^o\d/.test(model);
}

function isCodex(model: string): boolean {
  return model.includes("codex");
}

/// Whether the model exposes any reasoning-effort / extended-thinking control.
/// Non-reasoning models reject the parameter, so the request builders gate on
/// this.
/// Whether a model can receive image input. Unknown models fail closed so an
/// image is never sent to a model whose request contract we cannot verify.
export function supportsImages(kind: ProviderKind, model: string): boolean {
  return lookup(kind, model)?.inputModalities?.includes("image") ?? false;
}

export function supportsEffort(kind: ProviderKind, model: string): boolean {
  // Kimi's thinking is model-inherent (no request-side control), and the
  // Anthropic-compat layer's `thinking` parameter support is unverified —
  // expose no effort control regardless of the catalog's reasoning flag.
  if (kind === "Kimi") return false;
  const entry = lookup(kind, model);
  if (entry) return entry.reasoning;
  return supportsEffortFallback(kind, model);
}

function supportsEffortFallback(kind: ProviderKind, model: string): boolean {
  if (kind === "OpenAI")
    return model.startsWith("gpt-5") || isCodex(model) || isOSeries(model);
  // The 4.x families and 3.7 Sonnet support the extended-thinking block;
  // 3.5 and older do not.
  if (kind === "Anthropic")
    return (
      model.includes("claude-sonnet-4") ||
      model.includes("claude-opus-4") ||
      model.includes("claude-haiku-4") ||
      model.includes("3-7-sonnet")
    );
  return false;
}

/// The unified effort levels to offer for a model, ascending. Empty when the
/// model has no effort control (the picker hides the row).
export function effortLevels(kind: ProviderKind, model: string): Effort[] {
  if (!supportsEffort(kind, model)) return [];
  if (kind === "OpenAI") {
    const values = lookup(kind, model)?.effortValues ?? [];
    if (values.length > 0) {
      const levels: Effort[] = [];
      for (const value of values) {
        const level = effortFromValue(value);
        if (level && !levels.includes(level)) levels.push(level);
      }
      levels.sort((a, b) => rank(a) - rank(b));
      return levels;
    }
    return openaiEffortLevelsFallback(model);
  }
  if (kind === "Anthropic") return ["minimal", "low", "medium", "high"];
  return [];
}

function openaiEffortLevelsFallback(model: string): Effort[] {
  if (isOSeries(model)) return ["low", "medium", "high"];
  if (isCodex(model)) return ["minimal", "low", "medium", "high", "xhigh"];
  return ["minimal", "low", "medium", "high"];
}

/// OpenAI `reasoning.effort` value for the model, clamped to the levels the
/// model actually accepts (from the catalog, or name heuristics as fallback).
export function openaiEffortValue(model: string, effort: Effort): string {
  const values = lookup("OpenAI", model)?.effortValues ?? [];
  if (values.length > 0) return clampTo(values, effort);
  return openaiEffortValueFallback(model, effort);
}

function openaiEffortValueFallback(model: string, effort: Effort): string {
  switch (effort) {
    case "minimal":
      return isOSeries(model) ? "low" : "minimal";
    case "xhigh":
      return isCodex(model) ? "xhigh" : "high";
    default:
      return effort;
  }
}

/// Anthropic extended-thinking tier for the level: `[budgetTokens, maxTokens]`
/// upholding the API invariant `maxTokens > budgetTokens >= 1024`. Undefined
/// means "no thinking block" (fast path), keeping the default max_tokens.
export function anthropicThinkingTier(
  effort: Effort,
): [number, number] | undefined {
  switch (effort) {
    case "minimal":
      return undefined;
    case "low":
      return [4096, 16384];
    case "medium":
      return [8192, 24576];
    case "high":
      return [16384, 32768];
    // Anthropic has no distinct concept above the top budget tier.
    case "xhigh":
      return [24576, 49152];
  }
}
