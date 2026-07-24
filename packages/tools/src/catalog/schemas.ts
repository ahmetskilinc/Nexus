/// The tool catalog: every built-in tool's schema, its dispatch category,
/// and the availability policy. Keeping the policy here lets both schema
/// registration and dispatch-time re-checks enforce the same boundary.

import { AUX_TOOLS } from "./defs-aux";
import { MUTATING_TOOLS } from "./defs-mutating";
import { READONLY_TOOLS } from "./defs-readonly";
import type { ToolKind, ToolMode, ToolSchema } from "./kinds";

/// All built-in tools, web included; `toolSchemas()` filters by the web flag.
/// Order matches the Rust catalog (it determines registration order).
const CATALOG: readonly ToolSchema[] = [
  ...READONLY_TOOLS,
  ...MUTATING_TOOLS,
  ...AUX_TOOLS,
];

/// Whether one built-in tool belongs to a run's capability set. The agent
/// loop calls this again at dispatch time, so a tool that was not registered
/// (or a mode-inappropriate call) is rejected even if the model names it.
export function isAvailable(
  name: string,
  webAccess: boolean,
  mode: ToolMode,
): boolean {
  const schema = CATALOG.find((entry) => entry.name === name);
  if (schema === undefined) return false;
  if (schema.kind === "web" && !webAccess) return false;
  switch (mode) {
    case "standard":
      return schema.kind !== "plan" && schema.kind !== "research";
    case "plan":
      return schema.kind !== "research";
    case "research":
      return (
        schema.kind === "readOnly" ||
        schema.kind === "web" ||
        schema.kind === "subAgent" ||
        schema.kind === "askUser" ||
        schema.kind === "research"
      );
  }
}

/// The registered tools for a run. Research mode is a strict read-only
/// capability set; Plan gets its publishing tool; Standard gets neither
/// artifact-publishing tool. Web tools additionally require the user setting.
export function toolSchemas(webAccess: boolean, mode: ToolMode): ToolSchema[] {
  return CATALOG.filter((schema) => isAvailable(schema.name, webAccess, mode));
}

/// The dispatch category of a built-in tool, undefined for anything else
/// (MCP tools, hallucinated names).
export function kindOf(name: string): ToolKind | undefined {
  return CATALOG.find((schema) => schema.name === name)?.kind;
}
