import type { AgentMessage } from "@nexus/protocol";

/// Wraps one tool schema into the Messages API `input_schema` shape.
export function wrapSchema(
  name: string,
  description: string,
  parameters: unknown,
): unknown {
  return { name, description, input_schema: parameters };
}

type RoleMessage = { role: "user" | "assistant"; content: unknown };

/// Folds the flat message history into Anthropic's role/content-block format:
/// consecutive assistant text and tool_use blocks merge into one assistant
/// message, tool_result blocks into one user message.
export function messages(history: AgentMessage[]): unknown[] {
  const result: RoleMessage[] = [];
  let pendingRole: "user" | "assistant" | undefined;
  let pendingContent: unknown[] = [];

  const flush = () => {
    if (pendingRole && pendingContent.length > 0)
      result.push({ role: pendingRole, content: pendingContent });
    pendingRole = undefined;
    pendingContent = [];
  };

  for (const message of history) {
    switch (message.type) {
      case "user": {
        flush();
        result.push({ role: "user", content: message.text });
        break;
      }
      case "assistant_text": {
        if (pendingRole !== "assistant") {
          flush();
          pendingRole = "assistant";
        }
        pendingContent.push({ type: "text", text: message.text });
        break;
      }
      case "tool_call": {
        if (pendingRole !== "assistant") {
          flush();
          pendingRole = "assistant";
        }
        let input: unknown;
        try {
          input = JSON.parse(message.arguments);
        } catch {
          input = {};
        }
        pendingContent.push({
          type: "tool_use",
          id: message.id,
          name: message.name,
          input,
        });
        break;
      }
      case "tool_result": {
        if (pendingRole !== "user") {
          flush();
          pendingRole = "user";
        }
        pendingContent.push({
          type: "tool_result",
          tool_use_id: message.id,
          content: message.output,
        });
        break;
      }
    }
  }
  flush();
  return result;
}
