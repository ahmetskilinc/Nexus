import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "./Markdown";

/// Assistant markdown is untrusted model output, and the sanitizer chain that
/// bounds it is pinned in Markdown.tsx rather than inherited from Streamdown's
/// defaults. These tests are what keeps that pin honest: they assert on rendered
/// markup, so a dependency bump that quietly changes the chain fails here.
///
/// Note the assertions look for *live* markup (`<script`, an `onerror=`
/// attribute) rather than substrings — escaped text like `&lt;script&gt;` is the
/// desired outcome and must not be mistaken for a failure.
const render = (markdown: string) =>
  renderToStaticMarkup(<Markdown content={markdown} />);

describe("Markdown sanitization", () => {
  test("raw HTML is escaped to text, not parsed into elements", () => {
    const html = render(
      "<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>",
    );
    // No live elements. The escaped forms (`&lt;img …`) are the desired output
    // and legitimately contain the substring "onerror=", so assert on the
    // unescaped tag openers instead of on the attribute text.
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    // Still visible to the user as literal text.
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  test("javascript: links are blocked rather than rendered as hrefs", () => {
    const html = render("[click me](javascript:alert(1))");
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).toContain("[blocked]");
  });

  test("data: images are blocked", () => {
    const html = render("![img](data:text/html;base64,PHNjcmlwdD4=)");
    expect(html).not.toMatch(/src="data:/i);
    expect(html).toContain("Image blocked");
  });

  test("raw iframes never become elements", () => {
    const html = render('<iframe src="https://evil.example"></iframe>');
    expect(html).not.toMatch(/<iframe/i);
  });

  test("artifact variant adds document styling without changing rendering", () => {
    const html = renderToStaticMarkup(
      <Markdown
        content="# Plan\n\nA safe [link](https://example.com)."
        variant="artifact"
      />,
    );
    expect(html).toContain("nexus-artifact-prose");
    expect(html).toContain("Plan");
    expect(html).toContain("link");
  });

  test("ordinary content still renders", () => {
    // Streamdown renders emphasis as its own marked spans, not <strong>/<em>.
    const html = render("# Title\n\nSome **bold** text.");
    expect(html).toContain("Title");
    expect(html).toMatch(/data-streamdown="strong"[^>]*>bold</);
  });
});
