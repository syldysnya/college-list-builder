/**
 * `ChatPanel` — the left panel. A scrolling transcript of counselor/assistant
 * bubbles, a "thinking" indicator while a reply is in flight, an error line with
 * retry on failure, and a textarea + send button. Local draft state only; the
 * conversation itself is owned by the page.
 */
"use client";

import { useState } from "react";
import { ChatRole, type ChatMessage } from "@/lib/types";
import { content } from "@/lib/content";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

export type ChatStatus = "idle" | "loading" | "error";

export interface ChatPanelProps {
  messages: ChatMessage[];
  status: ChatStatus;
  onSend: (text: string) => void;
  onRetry: () => void;
  className?: string;
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isCounselor = message.role === ChatRole.enum.counselor;
  return (
    <div className={cn("flex", isCounselor ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
          isCounselor
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground",
        )}
      >
        {message.content}
      </div>
    </div>
  );
}

export function ChatPanel({ messages, status, onSend, onRetry, className }: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const isLoading = status === "loading";

  function submit() {
    const text = draft.trim();
    if (text.length === 0 || isLoading) return;
    onSend(text);
    setDraft("");
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col border-r border-border", className)}>
      <header className="border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold">{content.appName}</h1>
        <p className="text-sm text-muted-foreground">{content.ui.appTagline}</p>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-6" aria-label={content.ui.conversationLabel}>
        {messages.map((message, index) => (
          <MessageBubble key={index} message={message} />
        ))}
        {isLoading && (
          <p className="text-sm text-muted-foreground" role="status">
            {content.ui.thinkingLabel}
          </p>
        )}
        {status === "error" && (
          <button
            type="button"
            onClick={onRetry}
            className="text-sm text-primary underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {content.ui.errorRetry}
          </button>
        )}
      </div>

      <div className="flex items-end gap-2 border-t border-border p-4">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={content.ui.inputPlaceholder}
          rows={2}
          className="min-h-[2.5rem] flex-1 resize-none rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button onClick={submit} disabled={isLoading || draft.trim().length === 0}>
          {content.ui.sendLabel}
        </Button>
      </div>
    </div>
  );
}
