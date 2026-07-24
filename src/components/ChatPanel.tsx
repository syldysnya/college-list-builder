/**
 * `ChatPanel` — the chat itself (a child of the page's "main chat part"; the
 * app header is a sibling above it, owned by the page). Styled after Claude's
 * web chat: a centered conversation column where the counselor's turns sit in a
 * right-aligned bubble and the assistant's replies read as plain prose, over a
 * rounded composer. A "thinking" indicator and a dark-red error card with retry
 * appear inline. Local draft state only; the conversation is owned by the page.
 */
"use client";

import { useState } from "react";
import { ChatRole, type ChatMessage } from "@/lib/types";
import { content } from "@/lib/content";
import { Button } from "@/components/ui/Button";
import { SendIcon } from "@/components/ui/icons";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/cn";

export type ChatStatus = "idle" | "loading" | "error";

export interface ChatPanelProps {
  messages: ChatMessage[];
  status: ChatStatus;
  /** Specific error text to show (from the server, or a client-side fallback). */
  errorMessage?: string | null;
  onSend: (text: string) => void;
  onRetry: () => void;
  className?: string;
}

/** Centered conversation column width — matches Claude's readable measure. */
const COLUMN = "mx-auto w-full max-w-3xl";

function MessageBubble({ message }: { message: ChatMessage }) {
  const isCounselor = message.role === ChatRole.enum.counselor;
  // Counselor turns: a right-aligned brand-gradient bubble with white text.
  // Assistant turns: a white bordered card. Mirrors the reference chat styling.
  if (isCounselor) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-gradient-to-br from-primary to-primary-2 px-[18px] py-3 text-sm text-primary-foreground shadow-bubble">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="whitespace-pre-wrap rounded-2xl border border-border bg-card px-[18px] py-3.5 text-sm leading-relaxed text-foreground shadow-card">
      {message.content}
    </div>
  );
}

export function ChatPanel({ messages, status, errorMessage, onSend, onRetry, className }: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const isLoading = status === "loading";
  const isEmpty = messages.length === 0;

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
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="min-h-0 flex-1 overflow-y-auto pt-12" aria-label={content.ui.conversationLabel}>
        {isEmpty ? (
          <div className={cn(COLUMN, "flex h-full items-center px-4")}>
            <EmptyState onExampleSelect={onSend} className="w-full" />
          </div>
        ) : (
          <div className={cn(COLUMN, "flex flex-col gap-6 px-4 py-8")}>
            {messages.map((message, index) => (
              <MessageBubble key={index} message={message} />
            ))}
            {isLoading && (
              <p className="text-sm text-muted-foreground" role="status">
                {content.ui.thinkingLabel}
              </p>
            )}
            {status === "error" && (
              <div
                role="alert"
                className="space-y-2 rounded-md border border-destructive-border bg-destructive-surface px-3 py-2"
              >
                <p className="text-sm font-medium text-destructive">
                  {errorMessage ?? content.ui.errorGeneric}
                </p>
                <Button variant="outline" size="sm" onClick={onRetry}>
                  {content.ui.retryLabel}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className={cn(COLUMN, "px-4 pb-4 pt-2")}>
        <div className="flex items-end gap-2 rounded-3xl bg-card px-4 py-3 shadow-card ring-1 ring-border/70 focus-within:ring-2 focus-within:ring-ring">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={content.ui.inputPlaceholder}
            rows={1}
            className="max-h-40 min-h-[2.5rem] flex-1 resize-none bg-transparent px-2 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <Button
            onClick={submit}
            disabled={isLoading || draft.trim().length === 0}
            aria-label={content.ui.sendLabel}
            className="h-8 w-8 shrink-0 rounded-full p-0"
          >
            <SendIcon />
          </Button>
        </div>
      </div>
    </div>
  );
}
