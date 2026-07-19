import { isValidElement, type ReactNode, useEffect, useState } from "react";
import type { BundledLanguage, Highlighter } from "shiki";
import { Button } from "@/components/ui/button";
import { CheckIcon, CopyIcon, DownloadIcon } from "./Icons";
import { ToolCard } from "./ToolCard";

/// A drop-in replacement for Streamdown's built-in code block, wired via
/// `<Streamdown components={{ code: CodeBlock }} />`. Streamdown's own block is
/// not restyleable past a skin — its highlighted body and chrome are baked into
/// one component — so we own the chrome here to match the tool-call cards
/// (the shared ToolCard surface): a header row, a hairline divider, then the
/// code. Syntax highlighting is kept by driving shiki directly with the same
/// GitHub theme pair Streamdown used.

const HEADER = "flex items-center gap-2 px-3 py-1.5";

const THEMES = ["github-light-default", "github-dark-default"] as const;

// One highlighter for the whole app; languages load lazily on first use so we
// don't ship every grammar up front. shiki itself is dynamically imported so
// its core + regex engine stay out of the entry chunk until code first renders.
let highlighterPromise: Promise<Highlighter> | null = null;
const loadedLangs = new Set<string>();

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki").then(({ createHighlighter }) =>
      createHighlighter({ themes: [...THEMES], langs: [] }),
    );
  }
  return highlighterPromise;
}

/// Highlight `code` to a dual-theme HTML string. Unknown languages (or grammars
/// that fail to load mid-stream) degrade to plain `text` rather than throwing.
async function highlight(code: string, lang: string): Promise<string> {
  const hl = await getHighlighter();
  let language = lang || "text";
  if (language !== "text" && !loadedLangs.has(language)) {
    try {
      await hl.loadLanguage(language as BundledLanguage);
      loadedLangs.add(language);
    } catch {
      language = "text";
    }
  }
  return hl.codeToHtml(code, {
    lang: language,
    themes: { light: THEMES[0], dark: THEMES[1] },
    // Emit `--shiki-dark` CSS vars alongside the light colors; styles.css swaps
    // to them under `[data-theme="dark"]`.
    defaultColor: "light",
  });
}

/// Flatten react-markdown's `code` children (string, or a nested element whose
/// own children hold the text) down to the raw source.
function toText(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(toText).join("");
  if (isValidElement(children)) {
    const props = children.props as { children?: ReactNode };
    return toText(props.children);
  }
  return "";
}

const EXT: Record<string, string> = {
  javascript: "js",
  typescript: "ts",
  jsx: "jsx",
  tsx: "tsx",
  python: "py",
  rust: "rs",
  markdown: "md",
  shell: "sh",
  bash: "sh",
  json: "json",
  html: "html",
  css: "css",
  yaml: "yaml",
};

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded-md text-faint hover:bg-secondary/60 hover:text-muted-foreground"
    >
      {children}
    </Button>
  );
}

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      label={copied ? "Copied" : "Copy code"}
      onClick={() => {
        void navigator.clipboard.writeText(code).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? (
        <CheckIcon size={13} className="text-positive" />
      ) : (
        <CopyIcon size={13} />
      )}
    </IconButton>
  );
}

function DownloadButton({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  return (
    <IconButton
      label="Download code"
      onClick={() => {
        const blob = new Blob([code], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `snippet.${EXT[language] ?? "txt"}`;
        a.click();
        URL.revokeObjectURL(url);
      }}
    >
      <DownloadIcon size={13} />
    </IconButton>
  );
}

type CodeProps = {
  node?: unknown;
  className?: string;
  children?: ReactNode;
  // Streamdown's default <pre> stamps this onto the <code> element for fenced
  // blocks; its absence means inline code.
  "data-block"?: string;
};

/// Inline code — registered under Streamdown's dedicated `inlineCode` slot so it
/// never falls through to Streamdown's default heavy `bg-muted` pill. A faint
/// inset tint + hairline keeps it quiet in running text.
export function InlineCode({ children }: CodeProps) {
  return (
    <code className="rounded-[5px] border border-border-soft bg-accent px-[0.35em] py-[0.1em] font-mono text-[0.9em]">
      {children}
    </code>
  );
}

export function CodeBlock({ className, children, ...rest }: CodeProps) {
  // Streamdown routes inline code to `InlineCode` (registered separately), so
  // this component normally only sees fenced blocks; the guard keeps it correct
  // even if that routing changes.
  if (!("data-block" in rest)) return <InlineCode>{children}</InlineCode>;

  const language = className?.match(/language-([^\s]+)/)?.[1] ?? "";
  const code = toText(children).replace(/\n$/, "");
  return <BlockBody code={code} language={language || "text"} />;
}

function BlockBody({ code, language }: { code: string; language: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    void highlight(code, language).then((out) => {
      if (!stale) setHtml(out);
    });
    return () => {
      stale = true;
    };
  }, [code, language]);

  return (
    <ToolCard className="my-4">
      <div className={HEADER}>
        <span className="font-mono text-[12px] lowercase text-muted-foreground">
          {language}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <CopyButton code={code} />
          <DownloadButton code={code} language={language} />
        </div>
      </div>
      <div className="nexus-code overflow-x-auto border-t border-border-soft px-1 py-2.5">
        {html ? (
          // shiki output is escaped, self-contained HTML (safe protocols only);
          // Streamdown's harden pass never sees it since we render it directly.
          // biome-ignore lint/security/noDangerouslySetInnerHtml: shiki HTML
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre className="px-2 font-mono text-[13px] leading-relaxed">
            <code>{code}</code>
          </pre>
        )}
      </div>
    </ToolCard>
  );
}
