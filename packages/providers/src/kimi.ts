/// Kimi speaks the Anthropic Messages dialect on both of its endpoints; only
/// the endpoint and auth headers differ per credential. The AnthropicProvider
/// drives both — these constants are the per-credential data.
export const KIMI_API_KEY_ENDPOINT =
  "https://api.moonshot.ai/anthropic/v1/messages";
export const KIMI_OAUTH_ENDPOINT = "https://api.kimi.com/coding/v1/messages";
export const KIMI_MODELS_ENDPOINT = "https://api.moonshot.ai/v1/models";
