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

export async function run(
  deps: RunDeps,
  params: RunParams,
  mailbox: ApprovalMailbox,
): Promise<RunResult> {
  const credential: Credential =
    params.auth === "api_key"
      ? {
          kind: "api_key",
          apiKey: await deps.credentials.apiKey(params.providerId),
        }
      : {
          kind: "oauth",
          ...(await deps.credentials.oauthToken(
            params.providerId,
            params.kind,
          )),
        };
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
    const kimiHeaders =
      params.kind === "Kimi" && credential.kind === "oauth"
        ? await deps.credentials.kimiDeviceHeaders()
        : undefined;
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

/// The `(kind, credential)` dispatch into a concrete provider + summarizer.
/// Kimi speaks the Anthropic Messages dialect on both endpoints; only the
/// endpoint and auth headers differ per credential.
function buildProvider(
  params: RunParams,
  credential: Credential,
  systemPrompt: string,
  hub: McpHub,
  mode: ToolMode,
  kimiHeaders: Headers | undefined,
): { provider: Provider; summarizer: Summarizer } {
  if (params.kind === "Anthropic") {
    if (credential.kind !== "api_key") throw RuntimeError.credentialMismatch();
    const headers: Headers = [
      ["x-api-key", credential.apiKey],
      ["anthropic-version", ANTHROPIC_VERSION],
    ];
    return {
      provider: AnthropicProvider.anthropic(
        params.model,
        params.effort,
        systemPrompt,
        credential.apiKey,
        assembleSchemas(params.webAccess, mode, hub, anthropicWrapSchema),
      ),
      summarizer: new Summarizer({
        kind: "Anthropic",
        model: params.model,
        endpoint: MESSAGES_ENDPOINT,
        headers,
        chatgptBackend: false,
      }),
    };
  }
  if (params.kind === "Kimi") {
    const [endpoint, headers]: [string, Headers] =
      credential.kind === "api_key"
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
      summarizer: new Summarizer({
        kind: "Kimi",
        model: params.model,
        endpoint,
        headers,
        chatgptBackend: false,
      }),
    };
  }
  // OpenAI: the summarizer hits the same endpoint with the same auth headers
  // as the run's provider; only the API-key backend chains server-side.
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
      summarizer: new Summarizer({
        kind: "OpenAI",
        model: params.model,
        endpoint: OPENAI_API_ENDPOINT,
        headers: [["Authorization", `Bearer ${credential.apiKey}`]],
        chatgptBackend: false,
      }),
    };
  }
  const headers: Headers = [
    ["Authorization", `Bearer ${credential.accessToken}`],
    ["OpenAI-Beta", "responses=experimental"],
    ["originator", "codex_cli_rs"],
    ["session_id", crypto.randomUUID()],
  ];
  if (credential.accountId)
    headers.push(["chatgpt-account-id", credential.accountId]);
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
    summarizer: new Summarizer({
      kind: "OpenAI",
      model: params.model,
      endpoint: CHATGPT_ENDPOINT,
      headers,
      chatgptBackend: true,
    }),
  };
}
