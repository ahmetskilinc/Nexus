import { describe, expect, test } from "bun:test";
import { parseDuckDuckGo, webSearch } from "./web-search";

const signal = () => new AbortController().signal;

const SAMPLE = `
<div class="result">
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs&amp;rut=abc">Example <b>Docs</b></a>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=x">The official <b>documentation</b>.</a>
</div>
<div class="result">
  <a rel="nofollow" class="result__a" href="//other.example/page">Other Page</a>
</div>
`;

describe("parseDuckDuckGo", () => {
  test("extracts titles, decoded urls, and snippets", () => {
    const results = parseDuckDuckGo(SAMPLE);
    expect(results.length).toBe(2);
    expect(results[0]).toBe(
      "1. Example Docs\nhttps://example.com/docs\nThe official documentation.",
    );
    // Scheme-relative links are normalised; the missing snippet is omitted.
    expect(results[1]).toBe("2. Other Page\nhttps://other.example/page");
  });

  test("caps results at eight", () => {
    const many = Array.from(
      { length: 12 },
      (_, index) =>
        `<a class="result__a" href="https://example.com/${index}">R${index}</a>`,
    ).join("\n");
    expect(parseDuckDuckGo(many).length).toBe(8);
  });
});

describe("webSearch", () => {
  const fake = (response: () => Response) =>
    (async () => response()) as unknown as typeof fetch;

  test("requires a non-empty query", async () => {
    await expect(webSearch("   ", signal())).rejects.toThrow(
      '"query" is required.',
    );
  });

  test("formats parsed results", async () => {
    const output = await webSearch(
      "example docs",
      signal(),
      fake(() => new Response(SAMPLE, { status: 200 })),
    );
    expect(output).toContain("1. Example Docs");
    expect(output).toContain("https://example.com/docs");
  });

  test("reports no results", async () => {
    const output = await webSearch(
      "example",
      signal(),
      fake(() => new Response("<html></html>", { status: 200 })),
    );
    expect(output).toBe("No results found.");
  });

  test("surfaces HTTP failures", async () => {
    await expect(
      webSearch(
        "example",
        signal(),
        fake(() => new Response("busy", { status: 500 })),
      ),
    ).rejects.toThrow("search returned HTTP 500.");
  });
});
