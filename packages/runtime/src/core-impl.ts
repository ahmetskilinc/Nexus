import path from "node:path";
import type { CredentialResolver } from "@nexus/agent";
import {
  type CredentialStore,
  EncryptedFileCredentialStore,
  kimiDeviceHeaders,
  oauthAccount,
  validAccessToken,
} from "@nexus/auth";
import { RuntimeError } from "@nexus/protocol";
import { type ProviderKind, refreshModelsDev } from "@nexus/providers";
import type {
  CoreContext,
  HostBridge,
  RuntimeConfig,
  RuntimeCore,
} from "./core";
import { handleAgentRun, handleOauthSignin } from "./handlers/agent";
import {
  handleCredentialsDelete,
  handleCredentialsSet,
} from "./handlers/credentials";
import {
  handleMemoryClear,
  handleMemoryDelete,
  handleMemoryList,
} from "./handlers/memory";
import {
  handleMcpInspect,
  handleModelsCatalog,
  handleModelsList,
} from "./handlers/models";
import {
  handleCheckpointRestore,
  handleContextPreview,
  handleWorkspaceChanges,
  handleWorkspaceCommit,
  handleWorkspaceDiff,
  handleWorkspaceDiscard,
  handleWorkspaceIndex,
  handleWorkspaceInspect,
  handleWorkspaceStage,
  handleWorkspaceUnstage,
} from "./handlers/workspace";

/// The production core: the full method surface over the ported packages.
/// One instance per transport connection; constructed after init.
export class NexusCore implements RuntimeCore {
  private store: CredentialStore;
  private credentials: CredentialResolver;

  constructor(
    private config: RuntimeConfig,
    host: HostBridge,
    private fetchFn: typeof fetch = fetch,
  ) {
    this.store = new EncryptedFileCredentialStore(
      path.join(config.credentialsDir, "credentials.json"),
      {
        encrypt: (data) => host.encrypt(data),
        decrypt: (data) => host.decrypt(data),
      },
    );
    const store = this.store;
    const fetchImpl = this.fetchFn;
    this.credentials = {
      async apiKey(providerId: string): Promise<string> {
        const value = await store.get(providerId);
        if (value === undefined) {
          throw RuntimeError.msg(
            "Nexus could not access this provider credential in secure storage (no credential is stored for this provider).",
          );
        }
        return value;
      },
      async oauthToken(providerId: string, kind: ProviderKind) {
        const tokens = await validAccessToken(
          store,
          providerId,
          kind === "OpenAI" ? "openai" : "kimi",
          fetchImpl,
        );
        return { accessToken: tokens.accessToken, accountId: tokens.accountId };
      },
      kimiDeviceHeaders: async () =>
        Object.entries(await kimiDeviceHeaders(store)),
    };
    // Refresh the models.dev catalog into the disk cache in the background.
    // A no-op if the cache is still fresh or the network is down, so it never
    // delays or blocks request handling.
    void refreshModelsDev(this.fetchFn);
  }

  async handle(
    method: string,
    params: unknown,
    context: CoreContext,
  ): Promise<unknown> {
    switch (method) {
      case "health":
        return { runtime: "nexus-runtime", version: this.config.appVersion };
      case "workspace.index":
        return handleWorkspaceIndex(params);
      case "workspace.inspect":
        return handleWorkspaceInspect(params);
      case "workspace.changes":
        return handleWorkspaceChanges(params);
      case "workspace.diff":
        return handleWorkspaceDiff(params);
      case "workspace.stage":
        return handleWorkspaceStage(params);
      case "workspace.unstage":
        return handleWorkspaceUnstage(params);
      case "workspace.commit":
        return handleWorkspaceCommit(params);
      case "workspace.discard":
        return handleWorkspaceDiscard(params);
      case "checkpoint.restore":
        return handleCheckpointRestore(params);
      case "context.preview":
        return handleContextPreview(params);
      case "memory.list":
        return handleMemoryList(params);
      case "memory.delete":
        return handleMemoryDelete(params);
      case "memory.clear":
        return handleMemoryClear(params);
      case "credentials.set":
        return handleCredentialsSet(params, this.store);
      case "credentials.delete":
        return handleCredentialsDelete(params, this.store);
      case "models.catalog":
        return handleModelsCatalog(params);
      case "models.list":
        return handleModelsList(
          params,
          this.fetchFn,
          (providerId) => this.credentials.apiKey(providerId),
          context.signal,
        );
      case "mcp.inspect":
        return handleMcpInspect(params);
      case "agent.run":
        return handleAgentRun(params, context, this.fetchFn, this.credentials);
      case "oauth.signin":
        return handleOauthSignin(params, context, this.fetchFn, this.store);
      default:
        throw RuntimeError.msg(`Unknown method "${method}".`);
    }
  }

  /// Used by the credentials.delete path via handlers; exposed for tests.
  static oauthAccountName = oauthAccount;
}
