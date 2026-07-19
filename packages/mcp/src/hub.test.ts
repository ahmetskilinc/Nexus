import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { type McpServerConfig, ToolError } from "@nexus/protocol";
import { McpHub } from "./hub";

const FIXTURE = fileURLToPath(
  new URL("./fixtures/fake-server.mjs", import.meta.url),
);

function fakeServer(
  mode: string,
  overrides?: Partial<McpServerConfig>,
): McpServerConfig {
  return {
    name: "fake",
    command: process.execPath,
    args: [FIXTURE],
    env: { FAKE_MODE: mode },
    ...overrides,
  };
}

async function expectToolError(promise: Promise<string>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ToolError);
    return (error as ToolError).message;
  }
  throw new Error("expected the call to throw a ToolError");
}

const errorSpy = spyOn(console, "error").mockImplementation(() => {});
afterEach(() => {
  errorSpy.mockClear();
});
afterAll(() => {
  errorSpy.mockRestore();
});

describe("McpHub", () => {
  test("connects, lists namespaced tools, and proxies calls", async () => {
    const hub = await McpHub.connect([fakeServer("normal")]);
    try {
      const tools = hub.tools();
      expect(tools.map((tool) => tool.name)).toEqual([
        "mcp__fake__echo",
        "mcp__fake__mixed",
        "mcp__fake__empty",
      ]);
      expect(tools[0].description).toBe("Echoes its arguments");
      expect(tools[0].inputSchema).toEqual({
        type: "object",
        properties: { text: { type: "string" } },
      });
      // Tools without an inputSchema get the Rust default.
      expect(tools[1].inputSchema).toEqual({ type: "object", properties: {} });

      expect(hub.has("mcp__fake__echo")).toBe(true);
      expect(hub.has("mcp__fake__missing")).toBe(false);

      const echoed = await hub.call("mcp__fake__echo", '{"text":"hi"}');
      expect(echoed).toBe('echo:{"text":"hi"}');
    } finally {
      hub.dispose();
    }
  });

  test("flattens mixed and empty content like the Rust runtime", async () => {
    const hub = await McpHub.connect([fakeServer("normal")]);
    try {
      expect(await hub.call("mcp__fake__mixed", "{}")).toBe(
        "before\n[image content omitted]\nafter",
      );
      expect(await hub.call("mcp__fake__empty", "{}")).toBe(
        "(the tool returned no content)",
      );
    } finally {
      hub.dispose();
    }
  });

  test("treats unparseable arguments as an empty object", async () => {
    const hub = await McpHub.connect([fakeServer("normal")]);
    try {
      expect(await hub.call("mcp__fake__echo", "not json")).toBe("echo:{}");
    } finally {
      hub.dispose();
    }
  });

  test("prefixes isError results with Error:", async () => {
    const hub = await McpHub.connect([fakeServer("error-result")]);
    try {
      expect(await hub.call("mcp__fake__echo", "{}")).toBe("Error: boom");
    } finally {
      hub.dispose();
    }
  });

  test("throws ToolError for JSON-RPC error responses", async () => {
    const hub = await McpHub.connect([fakeServer("rpc-error")]);
    try {
      const message = await expectToolError(hub.call("mcp__fake__echo", "{}"));
      expect(message).toBe(
        'MCP server "fake" call failed: server exploded (tools/call)',
      );
    } finally {
      hub.dispose();
    }
  });

  test("throws ToolError for unknown tools", async () => {
    const hub = await McpHub.connect([]);
    const message = await expectToolError(hub.call("mcp__nope__tool", "{}"));
    expect(message).toBe('unknown MCP tool "mcp__nope__tool".');
  });

  test("skips a server that never answers the handshake", async () => {
    const hub = await McpHub.connect([fakeServer("silent", { name: "slow" })], {
      timeoutMs: 250,
    });
    try {
      expect(hub.tools()).toEqual([]);
      expect(errorSpy).toHaveBeenCalledWith(
        'nexus: MCP server "slow" unavailable: "initialize" timed out',
      );
    } finally {
      hub.dispose();
    }
  });

  test("tolerates garbage lines in the server output", async () => {
    const hub = await McpHub.connect([fakeServer("garbage")]);
    try {
      expect(hub.has("mcp__fake__echo")).toBe(true);
      expect(await hub.call("mcp__fake__echo", '{"a":1}')).toBe('echo:{"a":1}');
    } finally {
      hub.dispose();
    }
  });

  test("sanitizes and caps exotic tool names", async () => {
    const hub = await McpHub.connect([fakeServer("exotic")]);
    try {
      const names = hub.tools().map((tool) => tool.name);
      expect(names[0]).toBe("mcp__fake__weird_tool_name");
      expect(names[1].length).toBe(64);
      expect(names[1].startsWith("mcp__fake__xxx")).toBe(true);
      // The capped exposed name still routes back to the original tool.
      expect(await hub.call(names[1], "{}")).toBe("echo:{}");
    } finally {
      hub.dispose();
    }
  });

  test("keeps working servers when another fails to spawn", async () => {
    const hub = await McpHub.connect([
      fakeServer("normal", {
        name: "broken",
        command: "/nonexistent/nexus-mcp-test-binary",
      }),
      fakeServer("normal"),
    ]);
    try {
      expect(hub.tools().map((tool) => tool.name)).toContain("mcp__fake__echo");
      expect(hub.has("mcp__broken__echo")).toBe(false);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const logged = errorSpy.mock.calls[0][0] as string;
      expect(logged).toStartWith(
        'nexus: MCP server "broken" unavailable: could not start "/nonexistent/nexus-mcp-test-binary":',
      );
    } finally {
      hub.dispose();
    }
  });

  test("skips servers with enabled set to false", async () => {
    const hub = await McpHub.connect([
      fakeServer("normal", { enabled: false }),
    ]);
    try {
      expect(hub.tools()).toEqual([]);
    } finally {
      hub.dispose();
    }
  });

  test("dispose kills servers so later calls fail", async () => {
    const hub = await McpHub.connect([fakeServer("normal")]);
    hub.dispose();
    const message = await expectToolError(hub.call("mcp__fake__echo", "{}"));
    expect(message).toBe(
      'MCP server "fake" call failed: the server closed its output (tools/call)',
    );
  });

  test("inspect lists tool summaries and kills the server", async () => {
    const summaries = await McpHub.inspect(fakeServer("normal"));
    expect(summaries).toEqual([
      { name: "echo", description: "Echoes its arguments" },
      { name: "mixed", description: "Text plus non-text content" },
      { name: "empty", description: "Returns no content" },
    ]);
  });
});
