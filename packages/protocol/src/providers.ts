export type ProviderKind = "OpenAI" | "Anthropic" | "Kimi";
export type AuthenticationMethod = "api_key" | "oauth";

/// A unified reasoning-effort level, ordered from least to most reasoning.
/// These are wire values; the providers package clamps them per model.
export type Effort = "minimal" | "low" | "medium" | "high" | "xhigh";

export type ProviderProfile = {
  id: string;
  name: string;
  kind: ProviderKind;
  authentication: AuthenticationMethod;
};

/// One external MCP (Model Context Protocol) server the runtime spawns and
/// exposes as tools.
export type McpServerConfig = {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
};

/// One model in the picker, enriched from the models.dev catalog by the runtime.
/// `effort` lists the reasoning-effort levels the model actually accepts (empty
/// for non-reasoning models); `context`/cost are metadata for display.
export type ModelInfo = {
  id: string;
  name: string;
  reasoning: boolean;
  effort: Effort[];
  context?: number;
  maxOutput?: number;
  costInput?: number;
  costOutput?: number;
  toolCall?: boolean;
  releaseDate?: string;
  status?: string;
  modalities?: string[];
};

/// The load state of one provider's model list in the renderer.
export type ModelsEntry = {
  models?: ModelInfo[];
  loading: boolean;
  error?: string;
};
