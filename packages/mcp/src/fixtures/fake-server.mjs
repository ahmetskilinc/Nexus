// A fake stdio MCP server for tests, driven by the FAKE_MODE env var:
//   normal       full handshake, echo/mixed/empty tools
//   silent       reads requests but never answers (exercises the timeout path)
//   garbage      emits non-JSON lines before every valid response
//   error-result tools/call answers with isError content
//   rpc-error    tools/call answers with a JSON-RPC error object
//   exotic       tools/list returns names that need sanitising and capping
import { createInterface } from "node:readline";

const mode = process.env.FAKE_MODE ?? "normal";

const send = (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const toolsForMode = () => {
  if (mode === "exotic") {
    return [
      { name: "weird tool!name", description: "odd characters" },
      { name: "x".repeat(80), description: "very long name" },
    ];
  }
  return [
    {
      name: "echo",
      description: "Echoes its arguments",
      inputSchema: { type: "object", properties: { text: { type: "string" } } },
    },
    { name: "mixed", description: "Text plus non-text content" },
    { name: "empty", description: "Returns no content" },
  ];
};

const callResult = (params) => {
  if (mode === "error-result") {
    return { isError: true, content: [{ type: "text", text: "boom" }] };
  }
  const name = params?.name;
  if (name === "mixed") {
    return {
      content: [
        { type: "text", text: "before" },
        { type: "image", data: "aGk=" },
        { type: "text", text: "after" },
      ],
    };
  }
  if (name === "empty") {
    return { content: [] };
  }
  return {
    content: [
      { type: "text", text: `echo:${JSON.stringify(params?.arguments ?? {})}` },
    ],
  };
};

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const trimmed = line.trim();
  if (trimmed === "") return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (message.id === undefined) return; // A notification; nothing to answer.
  if (mode === "silent") return;
  if (mode === "garbage") {
    process.stdout.write("this is not json\n");
    process.stdout.write('{"broken": \n');
  }
  switch (message.method) {
    case "initialize":
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          serverInfo: { name: "fake", version: "0.0.0" },
        },
      });
      break;
    case "tools/list":
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: { tools: toolsForMode() },
      });
      break;
    case "tools/call":
      if (mode === "rpc-error") {
        send({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32000, message: "server exploded" },
        });
        break;
      }
      // An interleaved notification the client must skip while waiting.
      send({ jsonrpc: "2.0", method: "notifications/progress", params: {} });
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: callResult(message.params),
      });
      break;
    default:
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: "method not found" },
      });
  }
});
