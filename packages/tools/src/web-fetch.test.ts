import { describe, expect, test } from "bun:test";
import { webFetch } from "./web-fetch";

const signal = () => new AbortController().signal;

/// A fetch double keyed by exact URL; throws on anything unexpected.
function fakeFetch(
  routes: Record<string, () => Response>,
  log: string[] = [],
): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    log.push(url);
    const route = routes[url];
    if (route === undefined) throw new Error(`unexpected fetch of ${url}`);
    return route();
  }) as typeof fetch;
}

const neverFetch = fakeFetch({});

describe("webFetch", () => {
  test("refuses internal targets and non-HTTP(S) schemes", async () => {
    await expect(
      webFetch("http://169.254.169.254/", signal(), neverFetch),
    ).rejects.toThrow("non-public");
    await expect(
      webFetch("ftp://example.com/", signal(), neverFetch),
    ).rejects.toThrow("http://");
  });

  test("returns metadata and extracted text", async () => {
    const routes = {
      "http://93.184.216.34/": () =>
        new Response("<html><body><p>Hello page</p></body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    };
    const output = await webFetch(
      "http://93.184.216.34/",
      signal(),
      fakeFetch(routes),
    );
    expect(output).toContain("Source: http://93.184.216.34/");
    expect(output).toContain("Final URL: http://93.184.216.34/");
    expect(output).toContain("Status: 200");
    expect(output).toContain("Truncated: false");
    expect(output).toContain("Hello page");
    expect(output).not.toContain("<p>");
  });

  test("re-checks the SSRF guard on every redirect hop", async () => {
    const log: string[] = [];
    const routes = {
      "http://93.184.216.34/": () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/admin" },
        }),
    };
    await expect(
      webFetch("http://93.184.216.34/", signal(), fakeFetch(routes, log)),
    ).rejects.toThrow("non-public address (127.0.0.1)");
    // The internal hop was never fetched — the guard fired first.
    expect(log).toEqual(["http://93.184.216.34/"]);
  });

  test("follows public redirects and reports the final URL", async () => {
    const routes = {
      "http://93.184.216.34/": () =>
        new Response(null, {
          status: 301,
          headers: { location: "/moved" },
        }),
      "http://93.184.216.34/moved": () =>
        new Response("plain text body", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
    };
    const output = await webFetch(
      "http://93.184.216.34/",
      signal(),
      fakeFetch(routes),
    );
    expect(output).toContain("Final URL: http://93.184.216.34/moved");
    expect(output).toContain("plain text body");
  });

  test("rejects a non-HTTP(S) redirect", async () => {
    const routes = {
      "http://93.184.216.34/": () =>
        new Response(null, {
          status: 302,
          headers: { location: "ftp://93.184.216.34/file" },
        }),
    };
    await expect(
      webFetch("http://93.184.216.34/", signal(), fakeFetch(routes)),
    ).rejects.toThrow("refusing to follow a non-HTTP(S) redirect.");
  });

  test("gives up after too many redirects", async () => {
    const routes: Record<string, () => Response> = {};
    for (let index = 0; index < 8; index += 1) {
      routes[`http://93.184.216.34/${index}`] = () =>
        new Response(null, {
          status: 302,
          headers: { location: `http://93.184.216.34/${index + 1}` },
        });
    }
    await expect(
      webFetch("http://93.184.216.34/0", signal(), fakeFetch(routes)),
    ).rejects.toThrow("too many redirects.");
  });

  test("rejects a declared over-limit body", async () => {
    const routes = {
      "http://93.184.216.34/": () =>
        new Response(null, {
          status: 200,
          headers: { "content-length": "3000000" },
        }),
    };
    await expect(
      webFetch("http://93.184.216.34/", signal(), fakeFetch(routes)),
    ).rejects.toThrow("exceeds the 2000000 byte limit.");
  });

  test("caps a streamed over-limit body and flags truncation", async () => {
    const big = "a".repeat(2_500_000);
    const routes = {
      "http://93.184.216.34/": () =>
        new Response(big, {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
    };
    const output = await webFetch(
      "http://93.184.216.34/",
      signal(),
      fakeFetch(routes),
    );
    expect(output).toContain("Truncated: true");
  });

  test("reports empty pages", async () => {
    const routes = {
      "http://93.184.216.34/": () =>
        new Response("<html><body></body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    };
    const output = await webFetch(
      "http://93.184.216.34/",
      signal(),
      fakeFetch(routes),
    );
    expect(output).toContain("The page returned no readable text.");
  });
});
