import { McpHub } from "@nexus/mcp";
import type { McpServerConfig } from "@nexus/protocol";
import {
  asArray,
  asBoolean,
  asRecord,
  asString,
  RuntimeError,
} from "@nexus/protocol";
import {
  catalogModels,
  fetchModels,
  parseAuthMethod,
  parseProviderKind,
} from "@nexus/providers";
import { stringParam } from "../params";

export function handleModelsCatalog(params: unknown) {
  const kind = parseProviderKind(stringParam(params, "providerKind"));
  const auth = parseAuthMethod(stringParam(params, "auth"));
  const models = catalogModels(kind, auth);
  return { models, default: models[0]?.id ?? null };
}

export async function handleModelsList(
  params: unknown,
  fetchFn: typeof fetch,
  getApiKey: (providerId: string) => Promise<string>,
  signal: AbortSignal,
) {
  const providerId = stringParam(params, "providerId");
  const kind = parseProviderKind(stringParam(params, "providerKind"));
  const auth = parseAuthMethod(stringParam(params, "auth"));
  const models = await fetchModels(
    fetchFn,
    kind,
    auth,
    () => getApiKey(providerId),
    signal,
  );
  return { models };
}

export async function handleMcpInspect(params: unknown) {
  const raw = asRecord(asRecord(params)?.server);
  const name = asString(raw?.name);
  const command = asString(raw?.command);
  if (!raw || name === undefined || command === undefined)
    throw RuntimeError.msg("The MCP server configuration is malformed.");
  const args = asArray(raw.args)?.flatMap((item) => {
    const text = asString(item);
    return text !== undefined ? [text] : [];
  });
  const envRecord = asRecord(raw.env);
  const env = envRecord
    ? Object.fromEntries(
        Object.entries(envRecord).flatMap(([key, value]) => {
          const text = asString(value);
          return text !== undefined ? [[key, text] as [string, string]] : [];
        }),
      )
    : undefined;
  const config: McpServerConfig = {
    name,
    command,
    args,
    env,
    enabled: asBoolean(raw.enabled),
  };
  const tools = await McpHub.inspect(config);
  return { tools };
}
