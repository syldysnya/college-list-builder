/**
 * Home — the split-view counselor UI. Chat on the left drives a live college
 * list on the right. Owns all conversation state and re-sends it to the
 * stateless `/api/chat` every turn; downloads the PDF from `/api/pdf`.
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
import { ChatPanel, type ChatStatus } from "@/components/ChatPanel";
import { ListPanel } from "@/components/ListPanel";

const CHAT_ENDPOINT = "/api/chat";
const PDF_ENDPOINT = "/api/pdf";
const JSON_HEADERS = { "Content-Type": "application/json" } as const;

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [list, setList] = useState<CollegeList | null>(null);
  const [clarifyingCount, setClarifyingCount] = useState(0);
  const [studentName, setStudentName] = useState<string | null>(null);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [isDownloading, setIsDownloading] = useState(false);

  // One chat turn. Takes the full outgoing transcript so it never reads stale
  // state; `retry` reuses the current transcript (which already ends with the
  // unanswered counselor turn).
  async function runChat(outgoing: ChatMessage[]) {
    setStatus("loading");
    const body: ChatRequest = { messages: outgoing, profile, list, clarifyingCount };
    try {
      const res = await fetch(CHAT_ENDPOINT, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("chat request failed");
      const data: ChatResponse = await res.json();

      setMessages([...outgoing, { role: ChatRole.enum.assistant, content: data.reply }]);
      setProfile(data.profile);
      setClarifyingCount(data.clarifyingCount);
      if (data.action === ChatAction.enum.list && data.list !== null) setList(data.list);
      if (data.studentName !== null) setStudentName(data.studentName);
      setStatus("idle");
    } catch {
      // Keep the transcript and any prior list — nothing is lost on failure.
      setStatus("error");
    }
  }

  function handleSend(text: string) {
    const outgoing = [...messages, { role: ChatRole.enum.counselor, content: text }];
    setMessages(outgoing);
    void runChat(outgoing);
  }

  function handleRetry() {
    void runChat(messages);
  }

  async function handleDownload() {
    if (list === null) return;
    setIsDownloading(true);
    try {
      const res = await fetch(PDF_ENDPOINT, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ list, studentName: studentName ?? list.studentName }),
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
      // A failed download is non-fatal; the list and transcript are untouched.
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <main className="grid h-screen grid-cols-1 md:grid-cols-2">
      <ChatPanel
        messages={messages}
        status={status}
        onSend={handleSend}
        onRetry={handleRetry}
        className="min-h-0"
      />
      <ListPanel
        list={list}
        onDownload={handleDownload}
        onExampleSelect={handleSend}
        isDownloading={isDownloading}
        className="min-h-0"
      />
    </main>
  );
}
