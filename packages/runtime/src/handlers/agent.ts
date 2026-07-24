import {
  ApprovalMailbox,
  compact,
  type CredentialResolver,
  DEFAULT_CONTEXT_TOKENS,
  estimateTokens,
  parseApprovalMode,
  type RunParams,
  run,
} from "@nexus/agent";
import { type CredentialStore, signInChatGpt, signInKimi } from "@nexus/auth";
import type { AgentMessage, McpServerConfig } from "@nexus/protocol";
import {
  asArray,
  asBoolean,
  asNumber,
  asRecord,
  asString,
  RuntimeError,
} from "@nexus/protocol";
import {
  DEFAULT_EFFORT,
  modelsDevLookup,
  parseAuthMethod,
  parseEffort,
  parseProviderKind,
} from "@nexus/providers";
import { commandEnvironmentFromString } from "@nexus/tools";
import type { CoreContext } from "../core";
import { stringParam } from "../params";

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), high);

function parseHistory(value: unknown): AgentMessage[] {
  const malformed = () =>
    RuntimeError.msg('The "history" parameter is malformed.');
  const items = asArray(value);
  if (!items) throw malformed();
  return items.map((item) => {
    const record = asRecord(item);
    const type = asString(record?.type);
    if (!record) throw malformed();
    switch (type) {
      case "user":
      case "assistant_text": {
        const text = asString(record.text);
        if (text === undefined) throw malformed();
        return { type, text };
      }
      case "tool_call": {
        const id = asString(record.id);
        const name = asString(record.name);
        const argumentsJson = asString(record.arguments);
        if (
          id === undefined ||
          name === undefined ||
          argumentsJson === undefined
        )
          throw malformed();
        return { type, id, name, arguments: argumentsJson };
      }
      case "tool_result": {
        const id = asString(record.id);
        const name = asString(record.name);
        const output = asString(record.output);
        if (id === undefined || name === undefined || output === undefined)
          throw malformed();
        return { type, id, name, output };
      }
      default:
        throw malformed();
    }
  });
}

function parseMcpServers(value: unknown): McpServerConfig[] {
  const items = asArray(value) ?? [];
  const servers: McpServerConfig[] = [];
  for (const item of items) {
    const record = asRecord(item);
    const name = asString(record?.name);
    const command = asString(record?.command);
    if (!record || name === undefined || command === undefined) continue;
    servers.push({
      name,
      command,
      args: asArray(record.args)?.flatMap((argument) => {
        const text = asString(argument);
        return text !== undefined ? [text] : [];
      }),
      env: asRecord(record.env)
        ? Object.fromEntries(
            Object.entries(asRecord(record.env) ?? {}).flatMap(
              ([key, entry]) => {
                const text = asString(entry);
                return text !== undefined
                  ? [[key, text] as [string, string]]
                  : [];
              },
            ),
          )
        : undefined,
      enabled: asBoolean(record.enabled),
    });
  }
  return servers;
}

export async function handleAgentRun(
  params: unknown,
  context: CoreContext,
  fetchFn: typeof fetch,
  credentials: CredentialResolver,
) {
  const record = asRecord(params) ?? {};
  const runParams: RunParams = {
    providerId: stringParam(params, "providerId"),
    kind: parseProviderKind(stringParam(params, "providerKind")),
    model: stringParam(params, "model"),
    auth: parseAuthMethod(stringParam(params, "auth")),
    workspacePath: stringParam(params, "workspacePath"),
    history: parseHistory(record.history),
    previousOpenAIResponseId: asString(record.previousOpenAIResponseId),
    effort:
      (asString(record.effort) !== undefined
        ? parseEffort(asString(record.effort) ?? "")
        : undefined) ?? DEFAULT_EFFORT,
    // Default to Ask so the trust boundary — not the UI — is safe by
    // default: a caller that omits approvalMode gets per-change approval,
    // never silent shell/file execution.
    approvalMode:
      asString(record.approvalMode) !== undefined
        ? parseApprovalMode(asString(record.approvalMode) ?? "")
        : "ask",
    commandEnvironment: commandEnvironmentFromString(
      asString(record.commandEnvironment) ?? "",
    ),
    maxToolRounds: clamp(asNumber(record.maxToolRounds) ?? 50, 1, 200),
    maxRunSeconds: clamp(asNumber(record.maxRunSeconds) ?? 900, 30, 3600),
    maxRunCostUsd: (() => {
      const value = asNumber(record.maxRunCostUsd);
      return value !== undefined && value > 0 ? value : undefined;
    })(),
    webAccess: asBoolean(record.webAccess) ?? false,
    mcpServers: parseMcpServers(record.mcpServers),
    customInstructions: asString(record.customInstructions),
  };

  const mailbox = new ApprovalMailbox();
  context.onApproval((callId, approved) =>
    mailbox.deliver({ callId, approved }),
  );
  const result = await run(
    {
      fetchFn,
      credentials,
      runId: context.requestId,
      emitter: context.emitter,
      signal: context.signal,
    },
    runParams,
    mailbox,
  );
  // Estimated cost from the models.dev catalog (USD per million tokens);
  // null when the model has no pricing there.
  const pricing = modelsDevLookup(runParams.kind, runParams.model);
  const costUsd =
    pricing?.costInput !== undefined && pricing.costOutput !== undefined
      ? (result.usage.inputTokens / 1e6) * pricing.costInput +
        (result.usage.outputTokens / 1e6) * pricing.costOutput
      : null;
  return {
    messages: result.messages,
    openAIResponseId: result.openaiResponseId ?? null,
    usage: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    },
    costUsd,
    checkpoint: result.checkpoint,
  };
}

/// Compacts a session's history on demand. Returns `messages: null` when
/// there was nothing worth compacting, so the caller can say so rather than
/// showing a marker for a no-op.
export async function handleAgentCompact(
  params: unknown,
  context: CoreContext,
  fetchFn: typeof fetch,
  credentials: CredentialResolver,
) {
  const record = asRecord(params) ?? {};
  const kind = parseProviderKind(stringParam(params, "providerKind"));
  const model = stringParam(params, "model");
  const compaction = await compact(
    { fetchFn, credentials, signal: context.signal },
    {
      providerId: stringParam(params, "providerId"),
      kind,
      model,
      auth: parseAuthMethod(stringParam(params, "auth")),
      history: parseHistory(record.history),
    },
  );
  if (!compaction) return { messages: null };
  return {
    messages: compaction.messages,
    summary: compaction.summary,
    removedMessages: compaction.removedMessages,
    keptMessages: compaction.keptMessages,
    // A fresh meter reading for the folded history. This is the char-based
    // estimate, not a provider count — the next real turn overwrites it with
    // the exact number — but it lets the meter drop the moment we return.
    usedTokens: estimateTokens(compaction.messages),
    contextTokens:
      modelsDevLookup(kind, model)?.context ?? DEFAULT_CONTEXT_TOKENS,
  };
}

export async function handleOauthSignin(
  params: unknown,
  context: CoreContext,
  fetchFn: typeof fetch,
  store: CredentialStore,
) {
  const providerId = stringParam(params, "providerId");
  const kind = parseProviderKind(stringParam(params, "providerKind"));
  if (kind === "Anthropic")
    throw RuntimeError.msg(
      "Anthropic providers use an API key, not a sign-in.",
    );
  const flow = kind === "OpenAI" ? signInChatGpt : signInKimi;
  const result = await flow({
    store,
    providerId,
    emitter: context.emitter,
    fetchFn,
  });
  return { email: result.email ?? null, accountId: result.accountId ?? null };
}
