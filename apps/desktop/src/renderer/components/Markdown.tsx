import { memo } from "react";
import { harden } from "rehype-harden";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { Streamdown } from "streamdown";
import type { PluggableList } from "unified";
import { CodeBlock, InlineCode } from "./CodeBlock";

/// The sanitizer schema applied to assistant markdown. Starts from
/// rehype-sanitize's GitHub-derived default (which is what bounds `href`/`src`
/// to safe protocols, so `javascript:` and `data:` links cannot survive) and adds
/// back the one attribute Streamdown's own remark plugin sets on fenced code.
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), "metastring"],
  },
};

/// The rehype chain we hand to Streamdown, replacing its defaults.
///
/// This is deliberately stated here rather than inherited. Streamdown's default
/// chain is `[rehype-raw, rehype-sanitize, rehype-harden]` with harden configured
/// as `allowedProtocols: ["*"], allowedLinkPrefixes: ["*"], allowedImagePrefixes:
/// ["*"], allowDataImages: true` — i.e. harden imposes nothing, raw HTML in model
/// output IS parsed, and the only real protection is the sanitize step's internal
/// default schema. That posture lives in a transitive dependency's private
/// constant, so a minor bump could change it silently.
///
/// Two deviations from that default, both intentional:
///   - `rehype-raw` is dropped, so raw HTML in model output is never parsed into
///     elements — it renders as visible text instead.
///   - `harden` gets real values: only http/https/mailto URLs, and no `data:`
///     images. Host prefixes stay open (`*`) because the agent legitimately links
///     to arbitrary documentation.
///
/// `harden` stays in the chain even though sanitize already bounds protocols: it
/// is what turns a rejected URL into a visible "[blocked]" marker rather than a
/// silently href-less link, so the user can see that something was stripped.
/// Markdown.test.tsx asserts both layers.
const REHYPE_PLUGINS: PluggableList = [
  [rehypeSanitize, SANITIZE_SCHEMA],
  [
    harden,
    {
      allowedProtocols: ["http", "https", "mailto"],
      allowedLinkPrefixes: ["*"],
      allowedImagePrefixes: ["*"],
      allowDataImages: false,
    },
  ],
];

/// Renders assistant markdown with Streamdown. Unlike a plain markdown renderer,
/// Streamdown gracefully closes the partial/unterminated markdown that arrives
/// mid-stream — open code fences, half-written `**bold`, dangling table rows —
/// so tokens render cleanly as they land instead of flickering.
///
/// Code (inline and fenced) is rendered by our own `CodeBlock` component rather
/// than Streamdown's built-in one, so fenced blocks match the tool-call cards
/// exactly (a single rounded surface + header row + divider). It still drives
/// shiki with the same GitHub theme pair, so highlighting and light/dark theming
/// are preserved.
///
/// Sanitization is pinned at this call site via `REHYPE_PLUGINS` above rather
/// than inherited from Streamdown's defaults — see the comment there for what
/// those defaults actually do. The one place we inject HTML is shiki's own
/// escaped output inside CodeBlock, which never contains model text verbatim.
function MarkdownImpl({
  content,
  variant = "chat",
}: {
  content: string;
  variant?: "chat" | "artifact";
  // Retained for call-site compatibility; Streamdown resolves the theme from
  // the DOM and closes incomplete markdown itself, so neither is read here.
  resolvedTheme?: "light" | "dark";
  highlight?: boolean;
}) {
  return (
    <Streamdown
      className={`nexus-prose ${variant === "artifact" ? "nexus-artifact-prose" : ""}`}
      components={{ code: CodeBlock, inlineCode: InlineCode }}
      rehypePlugins={REHYPE_PLUGINS}
    >
      {content}
    </Streamdown>
  );
}

export const Markdown = memo(MarkdownImpl);
