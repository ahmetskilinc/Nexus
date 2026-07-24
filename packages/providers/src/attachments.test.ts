import { describe, expect, test } from "bun:test";
import type { AgentMessage, EphemeralImage } from "@nexus/protocol";
import { messages } from "./anthropic/fold";
import { input } from "./openai/input";

const history: AgentMessage[] = [{ type: "user", text: "What is this?" }];
const image: EphemeralImage = {
  name: "diagram.png",
  mediaType: "image/png",
  dataUrl: "data:image/png;base64,cGl4ZWxz",
  size: 6,
};

describe("ephemeral image request folding", () => {
  test("OpenAI forwards a data URL only in the current user input", () => {
    expect(input(history, [image])).toEqual([
      {
        role: "user",
        content: [
          { type: "input_text", text: "What is this?" },
          { type: "input_image", image_url: image.dataUrl },
        ],
      },
    ]);
  });

  test("Anthropic forwards base64 only in the current user content", () => {
    expect(messages(history, [image])).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "What is this?" },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: "cGl4ZWxz",
            },
          },
        ],
      },
    ]);
  });

  test("history-only retries cannot reconstruct image bytes", () => {
    expect(JSON.stringify(input(history))).not.toContain("cGl4ZWxz");
    expect(JSON.stringify(messages(history))).not.toContain("cGl4ZWxz");
  });
});
