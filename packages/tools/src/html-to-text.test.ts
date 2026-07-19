import { describe, expect, test } from "bun:test";
import { htmlToText } from "./html-to-text";

describe("htmlToText", () => {
  test("strips markup and scripts", () => {
    const html =
      "<html><head><style>x{}</style></head><body><p>Hello</p><script>bad()</script><p>World &amp; more</p></body></html>";
    const text = htmlToText(html);
    expect(text).toContain("Hello");
    expect(text).toContain("World & more");
    expect(text).not.toContain("bad()");
    expect(text).not.toContain("<p>");
  });

  test("decodes common entities and collapses blank lines", () => {
    const text = htmlToText(
      "<div>a &lt;b&gt; &quot;c&quot; &#39;d&#x27;&nbsp;e</div>\n\n\n<div>f</div>",
    );
    expect(text).toBe("a <b> \"c\" 'd' e\n\nf");
  });
});
