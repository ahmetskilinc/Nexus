import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@nexus/protocol";
import { compactOnce, type Summarize } from "./compact";

const user = (text: string): AgentMessage => ({ type: "user", text });
const assistant = (text: string): AgentMessage => ({
  type: "assistant_text",
  text,
});

/// A Summarizer stand-in: `compactOnce` only ever calls `summarize`, so the
/// endpoint/header plumbing the real class carries is irrelevant here.
function fakeSummarizer(
  summarize: (input: string) => Promise<string>,
): Summarize {
  return { summarize: (_fetch, input) => summarize(input) };
}

const noFetch = (() => {
  throw new Error("no network in tests");
}) as unknown as typeof fetch;

const signal = () => new AbortController().signal;

/// Long enough that the keep-recent tail leaves older turns behind.
function longHistory(): AgentMessage[] {
  const history: AgentMessage[] = [user("original task")];
  for (let i = 0; i < 5; i += 1) {
    history.push(assistant(`step ${i}`), user(`next ${i}`));
  }
  return history;
}

describe("compactOnce", () => {
  test("folds the older turns behind a summary", async () => {
    const history = longHistory();
    let seen = "";
    const result = await compactOnce({
      summarizer: fakeSummarizer(async (input) => {
        seen = input;
        return "We did steps 0-4.";
      }),
      fetchFn: noFetch,
      messages: history,
      signal: signal(),
    });
    if (!result) throw new Error("expected a compaction");
    // The summarizer saw the older turns as a transcript.
    expect(seen).toContain("User: original task");
    const head = result.messages[0];
    if (head?.type !== "user") throw new Error("summary head must be user");
    expect(head.text).toContain("We did steps 0-4.");
    expect(result.summary).toBe("We did steps 0-4.");
    expect(result.keptMessages).toBe(result.messages.length);
    // Counts partition the original: what went away plus what stayed (minus
    // the summary message that replaced them) is the whole history.
    expect(result.removedMessages + result.keptMessages - 1).toBe(
      history.length,
    );
    expect(result.messages.length).toBeLessThan(history.length);
    // The input history is not mutated in place.
    expect(history[0]).toEqual(user("original task"));
  });

  test("returns undefined when the tail is the whole history", async () => {
    let called = false;
    const result = await compactOnce({
      summarizer: fakeSummarizer(async () => {
        called = true;
        return "unused";
      }),
      fetchFn: noFetch,
      messages: [user("only"), assistant("reply")],
      signal: signal(),
    });
    expect(result).toBeUndefined();
    // No provider round-trip is spent on a history too short to fold.
    expect(called).toBe(false);
  });

  test("a failing summarizer propagates to the caller", async () => {
    await expect(
      compactOnce({
        summarizer: fakeSummarizer(() =>
          Promise.reject(new Error("summary came back empty")),
        ),
        fetchFn: noFetch,
        messages: longHistory(),
        signal: signal(),
      }),
    ).rejects.toThrow("summary came back empty");
  });
});
