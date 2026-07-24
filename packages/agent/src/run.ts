import { realpathSync } from "node:fs";
import { McpHub } from "@nexus/mcp";
import type {
  AgentMessage,
  Effort,
  McpServerConfig,
  RuntimeEmitter,
} from "@nexus/protocol";
import { RuntimeError } from "@nexus/protocol";
import {
  ANTHROPIC_VERSION,
  AnthropicProvider,
  type AuthMethod,
  anthropicWrapSchema,
  CHATGPT_ENDPOINT,
  type Headers,
  KIMI_API_KEY_ENDPOINT,
  KIMI_OAUTH_ENDPOINT,
  MESSAGES_ENDPOINT,
  modelsDevLookup,
  OPENAI_API_ENDPOINT,
  OpenAiProvider,
  openaiWrapSchema,
  type Provider,
  type ProviderKind,
} from "@nexus/providers";
import {
  type CommandEnvironment,
  Toolbox,
  type ToolMode,
  toolSchemas,
} from "@nexus/tools";
import { CheckpointRecorder, memoryPromptBlock } from "@nexus/workspace";
import type { ApprovalMailbox } from "./approvals";
import { type Compaction, compactOnce } from "./compact";
import { augment, loadInstructionFile } from "./instructions";
import { type RunResult, runLoop, Summarizer } from "./loop";
import { type ApprovalMode, toolMode } from "./modes";
import { PLAN_ADDENDUM, RESEARCH_ADDENDUM, SYSTEM_PROMPT } from "./prompts";
import { type Credential, SubagentLauncher } from "./subagent";
import { ToolRunner } from "./tool-runner";

export type RunParams = {
  providerId: string;
  kind: ProviderKind;
  model: string;
  auth: AuthMethod;
  workspacePath: string;
  history: AgentMessage[];
  previousOpenAIResponseId?: string;
  effort: Effort;
  approvalMode: ApprovalMode;
  commandEnvironment: CommandEnvironment;
  maxToolRounds: number;
  maxRunSeconds: number;
  maxRunCostUsd?: number;
  webAccess: boolean;
  mcpServers: McpServerConfig[];
  customInstructions?: string;
};

/// What compacting a history needs: which model to summarize with and how to
/// authenticate. A strict subset of `RunParams`.
export type CompactParams = {
  providerId: string;
  kind: ProviderKind;
  model: string;
  auth: AuthMethod;
  history: AgentMessage[];
};

/// Credential access, injected by the runtime composition root so this
/// package never touches the credential store or OAuth plumbing directly.
export type CredentialResolver = {
  apiKey(providerId: string): Promise<string>;
  oauthToken(
    providerId: string,
    kind: ProviderKind,
  ): Promise<{ accessToken: string; accountId?: string }>;
  /// Kimi OAuth device headers (the X-Msh-* fingerprint set).
  kimiDeviceHeaders(): Promise<Headers>;
};

export type RunDeps = {
  fetchFn: typeof fetch;
  credentials: CredentialResolver;
  /// The run's request id, used as the checkpoint id.
  runId: string;
  emitter: RuntimeEmitter;
  signal: AbortSignal;
};

/// The model's context window from the models.dev catalog; undefined when the
/// catalog has no entry, in which case compaction falls back to a default.
function contextWindow(kind: ProviderKind, model: string): number | undefined {
  return modelsDevLookup(kind, model)?.context;
}

/// Assembles the provider tool list: the built-in tools (plus web tools when
/// enabled) followed by every MCP tool, each wrapped into the shape the
/// provider expects. MCP tools can have arbitrary side effects and are never
/// exposed in the strict read-only Research capability set.
function assembleSchemas(
  webAccess: boolean,
  mode: ToolMode,
  hub: McpHub,
  wrap: (name: string, description: string, parameters: unknown) => unknown,
): unknown[] {
  const schemas = toolSchemas(webAccess, mode).map((schema) =>
    wrap(schema.name, schema.description, schema.parameters),
  );
  if (mode !== "research") {
    for (const tool of hub.tools())
      schemas.push(wrap(tool.name, tool.description, tool.inputSchema ?? {}));
  }
  return schemas;
}

/// Resolves the provider credential for a run or a compaction, from either
/// the API-key store or the OAuth token store.
async function resolveCredential(
  credentials: CredentialResolver,
  params: { providerId: string; kind: ProviderKind; auth: AuthMethod },
): Promise<Credential> {
  return params.auth === "api_key"
    ? { kind: "api_key", apiKey: await credentials.apiKey(params.providerId) }
    : {
        kind: "oauth",
        ...(await credentials.oauthToken(params.providerId, params.kind)),
      };
}

/// Kimi's OAuth backend needs its device-fingerprint headers on every call;
/// every other (provider, credential) pair needs none.
async function deviceHeaders(
  credentials: CredentialResolver,
  kind: ProviderKind,
  credential: Credential,
): Promise<Headers | undefined> {
  return kind === "Kimi" && credential.kind === "oauth"
    ? await credentials.kimiDeviceHeaders()
    : undefined;
}

/// Compacts a session's history on demand: one no-tools summarizer round-trip
/// that folds the older turns into a summary. Undefined when there was nothing
/// worth compacting. Unlike `run` this touches no workspace, tools, or MCP
/// servers — it only needs a credential and the history.
export async function compact(
  deps: Pick<RunDeps, "fetchFn" | "credentials" | "signal">,
  params: CompactParams,
): Promise<Compaction | undefined> {
  const credential = await resolveCredential(deps.credentials, params);
  const summarizer = summarizerFor(
    params,
    credential,
    await deviceHeaders(deps.credentials, params.kind, credential),
  );
  return await compactOnce({
    summarizer,
    fetchFn: deps.fetchFn,
    messages: params.history,
    signal: deps.signal,
  });
}

export async function run(
  deps: RunDeps,
  params: RunParams,
  mailbox: ApprovalMailbox,
): Promise<RunResult> {
  const credential = await resolveCredential(deps.credentials, params);
  let workspace: string;
  try {
    workspace = realpathSync(params.workspacePath);
  } catch (error) {
    throw RuntimeError.msg(
      `The selected workspace could not be accessed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const checkpoint = new CheckpointRecorder(workspace, deps.runId);
  const toolbox = new Toolbox(workspace);
  const mode3 = toolMode(params.approvalMode);
  // Research mode does not even start configured MCP processes: its
  // capability boundary is workspace/web reads plus nested read-only agents.
  const hub = await McpHub.connect(
    mode3 === "research" ? [] : params.mcpServers,
  );
  try {
    const kimiHeaders = await deviceHeaders(
      deps.credentials,
      params.kind,
      credential,
    );
    const subagent = new SubagentLauncher({
      kind: params.kind,
      model: params.model,
      effort: params.effort,
      credential,
      kimiHeaders,
    });
    const runner = new ToolRunner({
      fetchFn: deps.fetchFn,
      toolbox,
      workspace,
      hub,
      emitter: deps.emitter,
      mode: params.approvalMode,
      commandEnvironment: params.commandEnvironment,
      webAccess: params.webAccess,
      subagent,
      signal: deps.signal,
    });

    const basePrompt =
      params.approvalMode === "plan"
        ? `${SYSTEM_PROMPT}\n\n${PLAN_ADDENDUM}`
        : params.approvalMode === "research"
          ? `${SYSTEM_PROMPT}\n\n${RESEARCH_ADDENDUM}`
          : SYSTEM_PROMPT;
    // Append the workspace instruction file (AGENTS.md / .nexus.md /
    // CLAUDE.md) and any per-workspace Settings override under a shared
    // header, then recall this workspace's saved memories.
    let systemPrompt = augment(
      basePrompt,
      loadInstructionFile(workspace),
      params.customInstructions,
    );
    const memoryBlock = await memoryPromptBlock(workspace);
    if (memoryBlock) systemPrompt = `${systemPrompt}\n\n${memoryBlock}`;

    const { provider, summarizer } = buildProvider(
      params,
      credential,
      systemPrompt,
      hub,
      mode3,
      kimiHeaders,
    );
    const pricing = modelsDevLookup(params.kind, params.model);
    return await runLoop({
      provider,
      runner,
      checkpoint,
      mailbox,
      messages: params.history,
      summarizer,
      fetchFn: deps.fetchFn,
      contextTokens: contextWindow(params.kind, params.model),
      maxToolRounds: params.maxToolRounds,
      maxRunSeconds: params.maxRunSeconds,
      maxRunCostUsd: params.maxRunCostUsd,
      pricing:
        pricing?.costInput !== undefined || pricing?.costOutput !== undefined
          ? { input: pricing.costInput, output: pricing.costOutput }
          : undefined,
    });
  } finally {
    hub.dispose();
    mailbox.close();
  }
}

/// Kimi speaks the Anthropic Messages dialect on both endpoints; only the
/// endpoint and auth headers differ per credential.
function kimiTarget(
  credential: Credential,
  kimiHeaders: Headers | undefined,
): [string, Headers] {
  return credential.kind === "api_key"
    ? [
        KIMI_API_KEY_ENDPOINT,
        [["Authorization", `Bearer ${credential.apiKey}`]],
      ]
    : [
        KIMI_OAUTH_ENDPOINT,
        [
          ...(kimiHeaders ?? []),
          ["Authorization", `Bearer ${credential.accessToken}`],
        ],
      ];
}

/// The `(kind, credential)` dispatch into the no-tools summarizer used for
/// compaction. Split out from `buildProvider` because compacting on demand
/// needs only this half — no tool schemas, no MCP hub, no system prompt.
function summarizerFor(
  params: { kind: ProviderKind; model: string },
  credential: Credential,
  kimiHeaders: Headers | undefined,
): Summarizer {
  if (params.kind === "Anthropic") {
    if (credential.kind !== "api_key") throw RuntimeError.credentialMismatch();
    return new Summarizer({
      kind: "Anthropic",
      model: params.model,
      endpoint: MESSAGES_ENDPOINT,
      headers: [
        ["x-api-key", credential.apiKey],
        ["anthropic-version", ANTHROPIC_VERSION],
      ],
      chatgptBackend: false,
    });
  }
  if (params.kind === "Kimi") {
    const [endpoint, headers] = kimiTarget(credential, kimiHeaders);
    return new Summarizer({
      kind: "Kimi",
      model: params.model,
      endpoint,
      headers,
      chatgptBackend: false,
    });
  }
  // OpenAI: the summarizer hits the same endpoint with the same auth headers
  // as the run's provider; only the API-key backend chains server-side.
  if (credential.kind === "api_key") {
    return new Summarizer({
      kind: "OpenAI",
      model: params.model,
      endpoint: OPENAI_API_ENDPOINT,
      headers: [["Authorization", `Bearer ${credential.apiKey}`]],
      chatgptBackend: false,
    });
  }
  const headers: Headers = [
    ["Authorization", `Bearer ${credential.accessToken}`],
    ["OpenAI-Beta", "responses=experimental"],
    ["originator", "codex_cli_rs"],
    ["session_id", crypto.randomUUID()],
  ];
  if (credential.accountId)
    headers.push(["chatgpt-account-id", credential.accountId]);
  return new Summarizer({
    kind: "OpenAI",
    model: params.model,
    endpoint: CHATGPT_ENDPOINT,
    headers,
    chatgptBackend: true,
  });
}

/// The `(kind, credential)` dispatch into a concrete provider, paired with the
/// summarizer that compacts its conversation.
function buildProvider(
  params: RunParams,
  credential: Credential,
  systemPrompt: string,
  hub: McpHub,
  mode: ToolMode,
  kimiHeaders: Headers | undefined,
): { provider: Provider; summarizer: Summarizer } {
  const summarizer = summarizerFor(params, credential, kimiHeaders);
  if (params.kind === "Anthropic") {
    if (credential.kind !== "api_key") throw RuntimeError.credentialMismatch();
    return {
      provider: AnthropicProvider.anthropic(
        params.model,
        params.effort,
        systemPrompt,
        credential.apiKey,
        assembleSchemas(params.webAccess, mode, hub, anthropicWrapSchema),
      ),
      summarizer,
    };
  }
  if (params.kind === "Kimi") {
    const [endpoint, headers] = kimiTarget(credential, kimiHeaders);
    return {
      provider: new AnthropicProvider(
        "Kimi",
        params.model,
        params.effort,
        systemPrompt,
        endpoint,
        headers,
        assembleSchemas(params.webAccess, mode, hub, anthropicWrapSchema),
      ),
      summarizer,
    };
  }
  const schemas = assembleSchemas(
    params.webAccess,
    mode,
    hub,
    openaiWrapSchema,
  );
  if (credential.kind === "api_key") {
    return {
      provider: new OpenAiProvider(
        params.model,
        params.effort,
        systemPrompt,
        { kind: "api-key", apiKey: credential.apiKey },
        params.previousOpenAIResponseId,
        params.history,
        schemas,
      ),
      summarizer,
    };
  }
  return {
    provider: new OpenAiProvider(
      params.model,
      params.effort,
      systemPrompt,
      {
        kind: "chatgpt",
        accessToken: credential.accessToken,
        accountId: credential.accountId,
      },
      undefined,
      params.history,
      schemas,
    ),
    summarizer,
  };
}
