import type { ToolMode } from "@nexus/tools";

/// Whether file-modifying tools apply immediately or wait for the user to
/// approve each one, plus Plan mode and the strictly read-only Research mode.
/// Wire values come from the desktop app; anything unknown falls back to
/// auto, but an *omitted* mode is parsed as "ask" upstream (safe by default).
export type ApprovalMode = "auto" | "ask" | "plan" | "research";

export function parseApprovalMode(value: string): ApprovalMode {
  switch (value) {
    case "ask":
      return "ask";
    case "plan":
      return "plan";
    case "research":
      return "research";
    default:
      return "auto";
  }
}

/// Whether mutations and commands must be approved before they run. Plan
/// executes under the same per-change approval as Ask; Research does not
/// expose these tools and remains fail-closed if one is attempted.
export function requiresApproval(mode: ApprovalMode): boolean {
  return mode === "ask" || mode === "plan" || mode === "research";
}

export function toolMode(mode: ApprovalMode): ToolMode {
  if (mode === "plan") return "plan";
  if (mode === "research") return "research";
  return "standard";
}
