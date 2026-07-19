import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  root: "src/renderer",
  resolve: {
    alias: { "@": path.resolve(__dirname, "src/renderer") },
  },
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
    // A handful of shiki grammars (cpp, emacs-lisp) and its oniguruma wasm
    // engine minify to 600–780 kB. They are single data files loaded on demand
    // the first time that language is highlighted, so they can't be split
    // further and don't affect startup; raise the limit past them so the
    // warning stays meaningful for chunks we actually control.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // Split the always-loaded vendor code out of the entry chunk. This is
        // about keeping each chunk small enough that the 800 kB warning above
        // still has teeth — Electron loads from disk, so there's no network
        // caching angle. xterm and shiki are NOT listed here: they leave the
        // entry via dynamic import (TerminalPanel, CodeBlock) instead, which
        // also defers their parse cost until first use.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return;
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) {
            return "react";
          }
          if (/node_modules\/(motion|framer-motion|motion-dom)\//.test(id)) {
            return "motion";
          }
          // Streamdown and the unified/remark/rehype pipeline behind it.
          if (
            /node_modules\/(streamdown|marked|unified|remark|rehype|micromark|mdast|hast|unist|vfile|property-information|space-separated-tokens|comma-separated-tokens|html-url-attributes|estree|devlop|bail|trough|zwitch|ccount|longest-streak|markdown-table|trim-lines|is-plain-obj|character-entities|decode-named-character-reference|stringify-entities|katex)/.test(
              id,
            )
          ) {
            return "markdown";
          }
        },
      },
    },
  },
});
