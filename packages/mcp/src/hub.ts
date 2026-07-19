import {
  asArray,
  asBoolean,
  asString,
  get,
  type McpServerConfig,
  ToolError,
} from "@nexus/protocol";
import { McpClient } from "./client";
import { namespacedToolName } from "./naming";
import type { McpHubOptions, McpToolInfo, McpToolSummary } from "./types";

/// An exposed tool plus the routing back to its origin server.
type HubTool = McpToolInfo & {
  serverIndex: number;
  originalName: string;
};

/// The set of connected servers plus the flattened tool list they expose.
/// Servers live for the duration of one agent run; call `dispose()` to kill
/// them (the Rust hub relied on `kill_on_drop`).
export class McpHub {
  private readonly servers: McpClient[] = [];
  private readonly toolList: HubTool[] = [];

  /// Connects to every configured server, tolerating individual failures: a
  /// server that fails to start or handshake is logged to stderr and skipped
  /// so the run still proceeds with whatever succeeded.
  static async connect(
    servers: McpServerConfig[],
    options?: McpHubOptions,
  ): Promise<McpHub> {
    const hub = new McpHub();
    for (const config of servers) {
      if (config.enabled === false) continue;
      try {
        const { client, tools } = await McpClient.start(
          config,
          options?.timeoutMs,
        );
        const index = hub.servers.length;
        hub.servers.push(client);
        for (const tool of tools) {
          hub.toolList.push({
            name: namespacedToolName(config.name, tool.name),
            description: tool.description,
            inputSchema: tool.parameters,
            serverIndex: index,
            originalName: tool.name,
          });
        }
      } catch (error) {
        console.error(
          `nexus: MCP server "${config.name}" unavailable: ${errorText(error)}`,
        );
      }
    }
    return hub;
  }

  /// Starts a single server just long enough to list its tools, for the
  /// desktop app's "inspect server" flow. The server is killed afterwards.
  static async inspect(
    config: McpServerConfig,
    options?: McpHubOptions,
  ): Promise<McpToolSummary[]> {
    const { client, tools } = await McpClient.start(config, options?.timeoutMs);
    client.dispose();
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
    }));
  }

  tools(): McpToolInfo[] {
    return this.toolList.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }));
  }

  has(name: string): boolean {
    return this.toolList.some((tool) => tool.name === name);
  }

  /// Invokes an exposed tool, returning model-facing text. Failures throw
  /// ToolError; the agent loop renders those with its "Error: " prefix, so
  /// the model sees the same sentences the Rust runtime produced.
  async call(name: string, argumentsJson: string): Promise<string> {
    const tool = this.toolList.find((candidate) => candidate.name === name);
    if (tool === undefined) {
      throw new ToolError(`unknown MCP tool "${name}".`);
    }
    let args: unknown;
    try {
      args = JSON.parse(argumentsJson);
    } catch {
      args = {};
    }
    const server = this.servers[tool.serverIndex];
    try {
      const result = await server.request("tools/call", {
        name: tool.originalName,
        arguments: args,
      });
      return renderToolResult(result);
    } catch (error) {
      throw new ToolError(
        `MCP server "${server.name}" call failed: ${errorText(error)}`,
      );
    }
  }

  dispose(): void {
    for (const server of this.servers) {
      server.dispose();
    }
  }
}

/// Flattens an MCP `tools/call` result into text. MCP returns a `content`
/// array of typed parts; we surface the text parts and note any non-text
/// ones. Exported for tests.
export function renderToolResult(result: unknown): string {
  const isError = asBoolean(get(result, "isError")) ?? false;
  const parts = asArray(get(result, "content"));
  let text: string;
  if (parts === undefined) {
    text = JSON.stringify(result);
  } else {
    text = parts
      .map((part) => {
        const type = asString(get(part, "type"));
        if (type === "text") return asString(get(part, "text")) ?? "";
        if (type !== undefined) return `[${type} content omitted]`;
        return "";
      })
      .join("\n");
  }
  if (text.trim() === "") {
    text = "(the tool returned no content)";
  }
  return isError ? `Error: ${text}` : text;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
