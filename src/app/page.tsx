/**
 * Home — a single-column chat. The counselor describes a student; the assistant
 * answers, and when it produces a list the college list renders inline in that
 * answer with a Download-PDF button. All conversation state lives here and is
 * re-sent (as role/content only) to the stateless `/api/chat` each turn.
 *
 * NON-streaming: each turn awaits a complete `ChatResponse`. The flow is driven
 * entirely from event handlers — no `useEffect` needed.
 */
"use client";

import { useState } from "react";
import {
  ChatAction,
  ChatRole,
  type ChatMessage,
  type ChatRequest,
  type ChatResponse,
  type CollegeList,
  type StudentProfile,
} from "@/lib/types";
import { content } from "@/lib/content";
import { ChatPanel, type ChatEntry, type ChatStatus } from "@/components/ChatPanel";

const CHAT_ENDPOINT = "/api/chat";
const PDF_ENDPOINT = "/api/pdf";
const JSON_HEADERS = { "Content-Type": "application/json" } as const;

export default function Home() {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [clarifyingCount, setClarifyingCount] = useState(0);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  // Pull the server's specific `{ error }` message from a non-OK response; fall
  // back to the generic copy if the body isn't the shape we expect.
  async function readServerError(res: Response): Promise<string> {
    try {
      const data: unknown = await res.json();
      if (
        data !== null &&
        typeof data === "object" &&
        "error" in data &&
        typeof (data as { error: unknown }).error === "string" &&
        (data as { error: string }).error.length > 0
      ) {
        return (data as { error: string }).error;
      }
    } catch {
      // Non-JSON body — fall through to the generic message.
    }
    return content.ui.errorGeneric;
  }

  // One chat turn. Takes the full outgoing transcript so it never reads stale
  // state; `retry` reuses the current transcript. Only role/content is sent to
  // the API; the college list an answer produces is attached client-side.
  async function runChat(outgoing: ChatEntry[]) {
    setStatus("loading");
    setErrorMessage(null);
    const messages: ChatMessage[] = outgoing.map(({ role, content: text }) => ({ role, content: text }));
    const body: ChatRequest = { messages, profile, list: null, clarifyingCount };

    let res: Response;
    try {
      res = await fetch(CHAT_ENDPOINT, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      });
    } catch {
      setErrorMessage(content.ui.errorNetwork);
      setStatus("error");
      return;
    }

    if (!res.ok) {
      setErrorMessage(await readServerError(res));
      setStatus("error");
      return;
    }

    try {
      const data: ChatResponse = await res.json();
      const answer: ChatEntry = {
        role: ChatRole.enum.assistant,
        content: data.reply,
        list: data.action === ChatAction.enum.list ? data.list : null,
      };
      setEntries([...outgoing, answer]);
      setProfile(data.profile);
      setClarifyingCount(data.clarifyingCount);
      setStatus("idle");
    } catch {
      setErrorMessage(content.ui.errorGeneric);
      setStatus("error");
    }
  }

  function handleSend(text: string) {
    const outgoing: ChatEntry[] = [...entries, { role: ChatRole.enum.counselor, content: text }];
    setEntries(outgoing);
    void runChat(outgoing);
  }

  function handleRetry() {
    void runChat(entries);
  }

  async function handleDownload(list: CollegeList) {
    setIsDownloading(true);
    try {
      const res = await fetch(PDF_ENDPOINT, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ list, studentName: list.studentName }),
      });
      if (!res.ok) throw new Error("pdf request failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = content.ui.downloadFilename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      // A failed download is non-fatal; the conversation is untouched.
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-background">
      <ChatPanel
        entries={entries}
        status={status}
        errorMessage={errorMessage}
        isDownloading={isDownloading}
        onSend={handleSend}
        onRetry={handleRetry}
        onDownload={handleDownload}
        className="min-h-0 flex-1"
      />
    </main>
  );
}
