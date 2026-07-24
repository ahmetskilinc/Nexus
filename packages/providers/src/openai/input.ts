import type { AgentMessage, EphemeralImage } from "@nexus/protocol";

/// Wraps one tool schema into the Responses API function shape.
export function wrapSchema(
  name: string,
  description: string,
  parameters: unknown,
): unknown {
  return { type: "function", name, description, parameters };
}

/// Replays the flat message history as Responses API input items.
export function input(
  history: AgentMessage[],
  images: EphemeralImage[] = [],
): unknown[] {
  return history.map((message) => {
    switch (message.type) {
      case "user":
        // Image bytes belong only to the latest user turn and are never present
        // in the persisted canonical history used on retries/follow-up turns.
        if (message === history.at(-1) && images.length > 0)
          return {
            role: "user",
            content: [
              { type: "input_text", text: message.text },
              ...images.map((image) => ({
                type: "input_image",
                image_url: image.dataUrl,
              })),
            ],
          };
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
