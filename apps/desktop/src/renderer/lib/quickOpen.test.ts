import { describe, expect, test } from "bun:test";
import { quickOpenScore, rankQuickOpen } from "./quickOpen";

describe("quick open ranking", () => {
  test("matches subsequences across path components", () => {
    expect(
      quickOpenScore("src/components/ChatPane.tsx", "cp ts"),
    ).toBeDefined();
    expect(quickOpenScore("src/components/ChatPane.tsx", "cz")).toBeUndefined();
  });

  test("ranks direct and boundary matches before incidental matches", () => {
    const ranked = rankQuickOpen(
      ["src/not-chat-panel.tsx", "src/components/ChatPane.tsx", "src/chat.ts"],
      "chat",
      10,
    );
    expect(ranked[0]).toBe("src/chat.ts");
    expect(ranked).toContain("src/components/ChatPane.tsx");
  });
});
