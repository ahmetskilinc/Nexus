import type { AgentMessage } from "@nexus/protocol";

/// Wraps one tool schema into the Responses API function shape.
export function wrapSchema(
  name: string,
  description: string,
  parameters: unknown,
): unknown {
  return { type: "function", name, description, parameters };
}

/// Replays the flat message history as Responses API input items.
export function input(history: AgentMessage[]): unknown[] {
  return history.map((message) => {
    switch (message.type) {
      case "user":
        return { role: "user", content: message.text };
      case "assistant_text":
        return { role: "assistant", content: message.text };
      case "tool_call":
        return {
          type: "function_call",
          call_id: message.id,
          name: message.name,
          arguments: message.arguments,
        };
      case "tool_result":
        return {
          type: "function_call_output",
          call_id: message.id,
          output: message.output,
        };
      default:
        // AgentMessage is a closed union; this satisfies the linter's
        // every-path-returns check without changing behavior.
        return message satisfies never;
    }
  });
}
