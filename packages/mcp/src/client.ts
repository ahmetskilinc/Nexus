import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import {
  asArray,
  asNumber,
  asRecord,
  asString,
  get,
  type McpServerConfig,
  ToolError,
} from "@nexus/protocol";

/// How long any single MCP request may take before it is abandoned. Bounds a
/// hung or slow server so it cannot stall the whole agent run.
const DEFAULT_TIMEOUT_MS = 30_000;
const PROTOCOL_VERSION = "2024-11-05";
const CLIENT_VERSION = "0.1.0";

export type DiscoveredTool = {
  name: string;
  description: string;
  parameters: unknown;
};

type Pending = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: ToolError) => void;
  timer: ReturnType<typeof setTimeout>;
};

/// One connected stdio MCP server: the spawned child process plus NDJSON
/// JSON-RPC framing over its stdin/stdout. Stderr is discarded, exactly like
/// the Rust runtime. The child is killed by `dispose()` (the explicit
/// replacement for Rust's `kill_on_drop`).
export class McpClient {
  readonly name: string;
  private readonly child: ChildProcess;
  private readonly timeoutMs: number;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private closed = false;

  private constructor(config: McpServerConfig, timeoutMs: number) {
    this.name = config.name;
    this.timeoutMs = timeoutMs;
    this.child = spawn(config.command, config.args ?? [], {
      env: { ...process.env, ...config.env },
      stdio: ["pipe", "pipe", "ignore"],
    });
    // Swallow late process/pipe errors; write failures surface through the
    // write callback and closed streams through handleClose.
    this.child.on("error", () => this.handleClose());
    this.child.stdin?.on("error", () => {});
    if (this.child.stdout) {
      const lines = createInterface({ input: this.child.stdout });
      lines.on("line", (line) => this.handleLine(line));
      lines.on("close", () => this.handleClose());
    }
  }

  /// Spawns the server, performs the `initialize` handshake, and lists its
  /// tools. On any failure the child is killed before the error propagates.
  static async start(
    config: McpServerConfig,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<{ client: McpClient; tools: DiscoveredTool[] }> {
    const client = new McpClient(config, timeoutMs);
    try {
      await client.awaitSpawn(config.command);
      await client.request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "nexus", version: CLIENT_VERSION },
      });
      await client.notify("notifications/initialized", {});
      const listed = await client.request("tools/list", {});
      return { client, tools: discoveredTools(listed) };
    } catch (error) {
      client.dispose();
      throw error;
    }
  }

  /// Sends a JSON-RPC request and waits for the response with the matching
  /// id; notifications and unrelated messages the server interleaves are
  /// handled (or skipped) by the shared line reader.
  request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new ToolError(`the server closed its output (${method})`));
        return;
      }
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ToolError(`"${method}" timed out`));
      }, this.timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      this.writeLine(payload).catch((error: ToolError) => {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  /// Sends a fire-and-forget JSON-RPC notification (no id, no response).
  notify(method: string, params: unknown): Promise<void> {
    return this.writeLine(JSON.stringify({ jsonrpc: "2.0", method, params }));
  }

  dispose(): void {
    this.closed = true;
    this.child.kill();
    this.handleClose();
  }

  private awaitSpawn(command: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.child.once("spawn", () => resolve());
      this.child.once("error", (error) =>
        reject(new ToolError(`could not start "${command}": ${error.message}`)),
      );
    });
  }

  private writeLine(line: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const stdin = this.child.stdin;
      if (!stdin || stdin.destroyed) {
        reject(new ToolError("no stdin pipe"));
        return;
      }
      stdin.write(`${line}\n`, (error) =>
        error ? reject(new ToolError(error.message)) : resolve(),
      );
    });
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (trimmed === "") return;
    let message: unknown;
    try {
      message = JSON.parse(trimmed);
    } catch {
      return; // Malformed server output is tolerated and skipped.
    }
    const id = asNumber(get(message, "id"));
    if (id === undefined) return;
    const pending = this.pending.get(id);
    if (pending === undefined) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    const error = get(message, "error");
    if (error !== undefined && error !== null) {
      const detail = asString(get(error, "message")) ?? "unknown error";
      pending.reject(new ToolError(`${detail} (${pending.method})`));
      return;
    }
    const record = asRecord(message);
    pending.resolve(record && "result" in record ? record.result : {});
  }

  private handleClose(): void {
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(
        new ToolError(`the server closed its output (${pending.method})`),
      );
    }
    this.pending.clear();
  }
}

function discoveredTools(listed: unknown): DiscoveredTool[] {
  const tools = asArray(get(listed, "tools")) ?? [];
  return tools.flatMap((tool) => {
    const name = asString(get(tool, "name"));
    if (name === undefined) return [];
    const record = asRecord(tool);
    return [
      {
        name,
        description: asString(get(tool, "description")) ?? "",
        parameters:
          record && "inputSchema" in record
            ? record.inputSchema
            : { type: "object", properties: {} },
      },
    ];
  });
}
