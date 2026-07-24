/**
 * `Markdown` — renders an assistant answer written in Markdown (headings, bold,
 * numbered lists, links). Block/inline element styling lives in the `.markdown`
 * scope in globals.css; only links need per-element behavior, so they render as
 * styled external links (new tab, `rel="noopener"`) — the "source" citations.
 *
 * react-markdown emits no raw HTML by default, so untrusted model output is safe.
 */
"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-primary underline decoration-primary/50 decoration-dotted underline-offset-2 transition hover:decoration-primary"
    >
      {children}
    </a>
  ),
};

export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown text-sm leading-relaxed text-foreground">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
