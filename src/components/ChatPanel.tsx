/**
 * `ChatPanel` — the chat itself: a centered conversation column over an elevated
 * composer. Counselor turns render as a right-aligned brand-gradient bubble;
 * assistant turns render as a white bordered card next to a brand avatar, and
 * when an answer produced a college list it renders inline beneath the reply
 * with a Download-PDF button. A "thinking" indicator and a dark-red error card
 * with retry appear inline. Local draft state only; the conversation is owned by
 * the page.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { ChatRole, type ChatMessage, type CollegeList } from "@/lib/types";
import { content } from "@/lib/content";
import { Button } from "@/components/ui/Button";
import { SendIcon, DownloadIcon, ChevronIcon } from "@/components/ui/icons";
import { EmptyState } from "@/components/EmptyState";
import { CollegeListView } from "@/components/CollegeListView";
import { Markdown } from "@/components/Markdown";
import { cn } from "@/lib/cn";

export type ChatStatus = "idle" | "loading" | "error";

/** A rendered conversation turn. The API only ever sees `role`/`content`; the
 * optional `list` is the college list an assistant answer produced (client-only). */
export interface ChatEntry extends ChatMessage {
  list?: CollegeList | null;
  steps?: string[];
}

export interface ChatPanelProps {
  entries: ChatEntry[];
  status: ChatStatus;
  /** Specific error text to show (from the server, or a client-side fallback). */
  errorMessage?: string | null;
  isDownloading?: boolean;
  onSend: (text: string) => void;
  onRetry: () => void;
  onDownload: (list: CollegeList) => void;
  className?: string;
}

/** Centered conversation column width — matches the reference readable measure. */
const COLUMN = "mx-auto w-full max-w-3xl";
/** Composer auto-grows up to this height (px), then scrolls (matches max-h-40). */
const MAX_TEXTAREA_PX = 160;

/**
 * Shared timing for the expand/collapse motion — the same slow, gentle
 * ease-in-out curve on the height, the fade, and the chevron so nothing snaps
 * out of step. Long + eased both ends so it never feels abrupt.
 */
const COLLAPSE_MOTION = "duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]";

/** How long each anticipated step stays "current" before the next is revealed. */
const STEP_INTERVAL_MS = 1100;

/** Live "Thinking…" indicator: pulsing dots + the pipeline steps revealed one at a time. */
function LiveThinking() {
  const steps = content.ui.thinkingSteps;
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    if (current >= steps.length - 1) return;
    const timer = setTimeout(() => setCurrent((value) => value + 1), STEP_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [current, steps.length]);
  return (
    <div className="flex animate-message-in flex-col gap-2" role="status" aria-label={content.ui.thinkingLabel}>
      <span className="w-fit animate-text-shimmer text-sm font-semibold tracking-tight">
        {content.ui.thinkingLabel}
      </span>
      <div className="ml-[9px] flex flex-col gap-2.5 border-l-2 border-border py-1 pl-4">
        {steps.slice(0, current + 1).map((step, index) => (
          <p key={index} className="text-xs font-normal text-gray-400">
            {step}
          </p>
        ))}
      </div>
    </div>
  );
}

/** Collapsible "Done thinking" progress trail — text steps down a vertical line. */
function ThinkingSteps({ steps }: { steps: string[] }) {
  const [expanded, setExpanded] = useState(false);
  if (steps.length === 0) return null;
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-fit cursor-pointer items-center gap-2 text-left"
      >
        <ChevronIcon
          width={18}
          height={18}
          className={cn(
            "shrink-0 text-primary-2 transition-transform",
            COLLAPSE_MOTION,
            !expanded && "-rotate-90",
          )}
        />
        <span className="text-sm font-semibold tracking-tight text-primary-2">
          {content.ui.doneThinkingLabel}
        </span>
      </button>
      <div
        className={cn(
          "grid grid-cols-[100%] transition-[grid-template-rows]",
          COLLAPSE_MOTION,
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div
          className={cn(
            "overflow-hidden transition-opacity",
            COLLAPSE_MOTION,
            expanded ? "opacity-100" : "opacity-0",
          )}
          aria-hidden={!expanded}
          inert={!expanded}
        >
          <div className="ml-[9px] mt-2 flex flex-col gap-2.5 border-l-2 border-border py-1 pl-4">
            {steps.map((step, index) => (
              <p key={index} className="text-xs font-normal text-gray-400">
                {step}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CounselorBubble({ text }: { text: string }) {
  return (
    <div className="flex animate-message-in justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-gradient-to-br from-primary to-primary-2 px-[18px] py-3 text-sm text-primary-foreground shadow-bubble">
        {text}
      </div>
    </div>
  );
}

/** An assistant reply plus, when present, a collapsible recommended-colleges card. */
function AssistantAnswer({
  entry,
  onDownload,
  isDownloading,
}: {
  entry: ChatEntry;
  onDownload: (list: CollegeList) => void;
  isDownloading: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const { list } = entry;
  return (
    <div className="flex animate-message-in flex-col gap-3">
      {entry.steps && entry.steps.length > 0 && <ThinkingSteps steps={entry.steps} />}
      <div className="rounded-2xl border border-border bg-card px-[18px] py-3.5 shadow-card">
        <Markdown>{entry.content}</Markdown>
      </div>
        {list && (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between gap-3 px-5 py-4">
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                aria-expanded={expanded}
                aria-label={content.ui.toggleListLabel}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
              >
                <h3 className="truncate text-lg font-medium tracking-tight text-foreground">
                  {content.ui.listHeading}
                </h3>
              </button>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDownload(list)}
                  disabled={isDownloading}
                  aria-label={content.ui.downloadLabel}
                  className="w-8 px-0"
                >
                  <DownloadIcon />
                </Button>
                <ChevronIcon
                  width={20}
                  height={20}
                  onClick={() => setExpanded((value) => !value)}
                  className={cn(
                    "shrink-0 cursor-pointer text-foreground transition-transform",
                    COLLAPSE_MOTION,
                    expanded && "rotate-180",
                  )}
                />
              </div>
            </div>
            <div
              className={cn(
                "grid grid-cols-[100%] transition-[grid-template-rows]",
                COLLAPSE_MOTION,
                expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
              )}
            >
              <div
                className={cn(
                  "overflow-hidden transition-opacity",
                  COLLAPSE_MOTION,
                  expanded ? "opacity-100" : "opacity-0",
                )}
                aria-hidden={!expanded}
                inert={!expanded}
              >
                <CollegeListView list={list} />
              </div>
            </div>
          </div>
        )}
    </div>
  );
}

function MessageRow({
  entry,
  onDownload,
  isDownloading,
}: {
  entry: ChatEntry;
  onDownload: (list: CollegeList) => void;
  isDownloading: boolean;
}) {
  if (entry.role === ChatRole.enum.counselor) {
    return <CounselorBubble text={entry.content} />;
  }
  return <AssistantAnswer entry={entry} onDownload={onDownload} isDownloading={isDownloading} />;
}

export function ChatPanel({
  entries,
  status,
  errorMessage,
  isDownloading = false,
  onSend,
  onRetry,
  onDownload,
  className,
}: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const isLoading = status === "loading";
  const isEmpty = entries.length === 0;

  // When the counselor sends a follow-up, scroll it (and the "Thinking…" below it)
  // into view. Only on a counselor turn, so a long answer arriving later does not
  // yank the view to the bottom past the question.
  useEffect(() => {
    const last = entries[entries.length - 1];
    if (last?.role === ChatRole.enum.counselor) {
      // Optional call: jsdom (tests) does not implement scrollIntoView.
      endRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
    }
  }, [entries]);

  // Grow the textarea to fit its content, up to MAX_TEXTAREA_PX (then it scrolls).
  function autoGrow() {
    const el = textareaRef.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`;
  }

  function submit() {
    if (isLoading) return;
    // Read the textarea's DOM value, not `draft` state: iOS Safari can insert text
    // (autocorrect / predictive) without firing React's onChange, leaving `draft`
    // stale. The DOM value is the source of truth for what the user actually typed.
    const text = (textareaRef.current?.value || draft).trim();
    if (text.length === 0) return;
    onSend(text);
    setDraft("");
    if (textareaRef.current !== null) {
      textareaRef.current.value = "";
      textareaRef.current.style.height = "auto";
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div
        className="scroll-thin min-h-0 flex-1 overflow-y-auto pt-6 sm:pt-12"
        aria-label={content.ui.conversationLabel}
      >
        {isEmpty ? (
          <div className={cn(COLUMN, "flex h-full items-center px-4")}>
            <EmptyState className="w-full" />
          </div>
        ) : (
          <div className={cn(COLUMN, "flex flex-col gap-6 px-4 py-8")}>
            {entries.map((entry, index) => (
              <MessageRow
                key={index}
                entry={entry}
                onDownload={onDownload}
                isDownloading={isDownloading}
              />
            ))}
            {isLoading && <LiveThinking />}
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
            <div ref={endRef} aria-hidden="true" />
          </div>
        )}
      </div>

      <div className={cn(COLUMN, "px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]")}>
        <div className="flex items-end gap-2 rounded-3xl bg-card px-4 py-3 shadow-card ring-1 ring-border/70 focus-within:ring-2 focus-within:ring-ring">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              autoGrow();
            }}
            onKeyDown={handleKeyDown}
            placeholder={content.ui.inputPlaceholder}
            rows={1}
            className="max-h-40 min-h-[2.5rem] flex-1 resize-none bg-transparent px-2 py-2 text-base text-foreground placeholder:text-muted-foreground focus:outline-none sm:text-sm"
          />
          <Button
            onClick={submit}
            disabled={isLoading}
            aria-label={content.ui.sendLabel}
            className="h-10 w-10 shrink-0 rounded-full bg-gradient-to-br from-primary to-primary-2 p-0 sm:h-8 sm:w-8"
          >
            <SendIcon />
          </Button>
        </div>
      </div>
    </div>
  );
}
