import type { Effort, ProviderKind } from "@nexus/protocol";

/// UI mirror of `runtime/src/providers/capabilities.rs`. Used only to decide
/// whether (and which) Effort options to show; the Rust runtime is authoritative
/// and re-clamps every value, so any drift here is cosmetic, never an API error.

export const DEFAULT_EFFORT: Effort = "medium";

/// Ascending order + display labels for the Effort control.
export const EFFORT_ORDER: Effort[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

export const EFFORT_LABEL: Record<Effort, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
};

function isOSeries(model: string): boolean {
  return /^o[0-9]/.test(model);
}

function isCodex(model: string): boolean {
  return model.includes("codex");
}

/// Whether the model exposes any reasoning-effort control. Mirrors the Rust
/// `supports_effort`.
export function supportsEffort(kind: ProviderKind, model: string): boolean {
  // Kimi's thinking is model-inherent; no request-side effort control.
  if (kind === "Kimi") return false;
  if (kind === "OpenAI")
    return model.startsWith("gpt-5") || isCodex(model) || isOSeries(model);
  return (
    model.includes("claude-sonnet-4") ||
    model.includes("claude-opus-4") ||
    model.includes("claude-haiku-4") ||
    model.includes("3-7-sonnet")
  );
}

/// The allowed effort levels for a (provider, model), in ascending order.
/// Empty when the model has no effort control (the UI hides the row).
export function effortLevels(kind: ProviderKind, model: string): Effort[] {
  if (!supportsEffort(kind, model)) return [];
  if (kind === "Anthropic") return ["minimal", "low", "medium", "high"];
  // OpenAI
  if (isOSeries(model)) return ["low", "medium", "high"];
  if (isCodex(model)) return ["minimal", "low", "medium", "high", "xhigh"];
  return ["minimal", "low", "medium", "high"]; // gpt-5.x non-codex
}

/// Clamp an effort to the nearest allowed level for the model, preserving intent
/// (a too-high pick lands on the model's max, a too-low pick on its min).
export function clampEffort(
  kind: ProviderKind,
  model: string,
  effort: Effort,
): Effort | undefined {
  const levels = effortLevels(kind, model);
  if (levels.length === 0) return undefined;
  if (levels.includes(effort)) return effort;
  const target = EFFORT_ORDER.indexOf(effort);
  // Nearest by ordinal distance, tie-breaking downward (cheaper).
  return levels.reduce((best, level) => {
    const d = Math.abs(EFFORT_ORDER.indexOf(level) - target);
    const bd = Math.abs(EFFORT_ORDER.indexOf(best) - target);
    return d < bd ? level : best;
  }, levels[0]);
}
