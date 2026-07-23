import { describe, expect, test } from "bun:test";
import { RuntimeError } from "@nexus/protocol";
import { openSse, SseParser } from "./sse";

const encode = (text: string) => new TextEncoder().encode(text);

describe("SseParser", () => {
  test("splits lines across chunk boundaries", () => {
    const parser = new SseParser();
    expect(parser.feed(encode('data: {"a":'))).toEqual([]);
    expect(parser.feed(encode("1}\n"))).toEqual([{ a: 1 }]);
  });

  test("handles crlf, [DONE], comments, and garbage", () => {
    const parser = new SseParser();
    const events = parser.feed(
      encode(
        'event: ping\r\ndata: [DONE]\r\n: comment\r\ndata: not json\r\ndata: {"ok":true}\r\n',
      ),
    );
    expect(events).toEqual([{ ok: true }]);
  });

  test("yields multiple events per chunk", () => {
    const parser = new SseParser();
    expect(
      parser.feed(encode('data: {"n":1}\ndata:{"n":2}\ndata: {"n":3}\n')),
    ).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  test("holds an incomplete trailing line", () => {
    const parser = new SseParser();
    expect(parser.feed(encode('data: {"n":1}'))).toEqual([]);
    expect(parser.feed(encode("\n"))).toEqual([{ n: 1 }]);
  });

  test("caps a pathologically long unterminated tail", () => {
    const parser = new SseParser();
    // Feed >4MiB with no newline; the buffer must reset rather than grow.
    const big = "x".repeat(1024 * 1024);
    for (let i = 0; i < 5; i += 1) expect(parser.feed(big)).toEqual([]);
    // Resyncs at the next newline.
    expect(parser.feed(encode('\ndata: {"ok":1}\n'))).toEqual([{ ok: 1 }]);
  });
});

/// A fetch stub that streams `chunks` as an SSE body.
export function sseFetch(
  chunks: string[],
  init?: { status?: number; body?: string },
): typeof fetch {
  return (() => {
    if (init?.status !== undefined && init.status !== 200)
      return Promise.resolve(
        new Response(init.body ?? "", { status: init.status }),
      );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encode(chunk));
        controller.close();
      },
    });
    return Promise.resolve(new Response(stream, { status: 200 }));
  }) as unknown as typeof fetch;
}

describe("openSse", () => {
  test("drains non-2xx bodies into RuntimeError.http", async () => {
    const fetchFn = sseFetch([], {
      status: 401,
      body: '{"error":{"message":"Invalid API key."}}',
    });
    const iterate = async () => {
      for await (const _ of openSse(
        fetchFn,
        "https://x",
        [],
        {},
        new AbortController().signal,
      )) {
        // no chunks expected
      }
    };
    await expect(iterate()).rejects.toThrow("Invalid API key. (HTTP 401)");
  });

  test("yields body chunks and completes", async () => {
    const fetchFn = sseFetch(['data: {"n":1}\n', 'data: {"n":2}\n']);
    const parser = new SseParser();
    const events: unknown[] = [];
    for await (const chunk of openSse(
      fetchFn,
      "https://x",
      [],
      {},
      new AbortController().signal,
    )) {
      events.push(...parser.feed(chunk));
    }
    expect(events).toEqual([{ n: 1 }, { n: 2 }]);
  });

  test("retries a rate-limited request using Retry-After", async () => {
    let calls = 0;
    const retries: unknown[] = [];
    const fetchFn = (() => {
      calls += 1;
      if (calls === 1)
        return Promise.resolve(
          new Response("busy", {
            status: 429,
            headers: { "Retry-After": "0" },
          }),
        );
      return sseFetch(['data: {"ok":true}\n'])("", {});
    }) as unknown as typeof fetch;
    const chunks: Uint8Array[] = [];
    for await (const chunk of openSse(
      fetchFn,
      "https://x",
      [],
      {},
      new AbortController().signal,
      undefined,
      { emit: (event) => retries.push(event) },
    ))
      chunks.push(chunk);
    expect(calls).toBe(2);
    expect(retries).toEqual([
      {
        type: "provider_retry",
        attempt: 1,
        delayMs: 0,
        reason: "Provider temporarily unavailable (HTTP 429)",
      },
    ]);
    expect(new TextDecoder().decode(chunks[0])).toContain('"ok":true');
  });

  test("network failure surfaces as a provider-request error", async () => {
    const fetchFn = (() =>
      Promise.reject(new Error("socket hang up"))) as unknown as typeof fetch;
    const iterate = async () => {
      for await (const _ of openSse(
        fetchFn,
        "https://x",
        [],
        {},
        new AbortController().signal,
      )) {
        // unreachable
      }
    };
    await expect(iterate()).rejects.toThrow(
      "The provider request failed: socket hang up",
    );
    await expect(iterate()).rejects.toBeInstanceOf(RuntimeError);
  });
});
