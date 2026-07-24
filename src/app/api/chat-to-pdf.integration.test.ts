/**
 * Cross-route integration: a list built by POST /api/chat is valid input to
 * POST /api/pdf. This exercises the whole grounded pipeline end to end —
 * router → deterministic matching → curate → dataset id-integrity → PDF render —
 * with only the LLM boundary mocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ChatAction,
  ChatRole,
  emptyProfile,
  type ChatResponse,
  type StudentProfile,
} from "@/lib/types";

// Hoisted mock state: values `generateObject` returns in call order (router,
// then curate on a list decision).
const state = vi.hoisted(() => ({ responses: [] as unknown[], idx: 0 }));

vi.mock("@/lib/llm", () => ({
  getProvider: () => ({
    async generateObject() {
      const value = state.responses[state.idx] ?? {};
      state.idx += 1;
      return { value, usage: { inputTokens: 0, outputTokens: 0 } };
    },
    generateText() {
      throw new Error("generateText not used");
    },
    streamText() {
      throw new Error("streamText not used");
    },
  }),
}));

// Import the routes AFTER the mock is registered.
const { POST: chatPost } = await import("@/app/api/chat/route");
const { POST: pdfPost } = await import("@/app/api/pdf/route");

const routerListValue = {
  profile: emptyProfile() as StudentProfile,
  action: ChatAction.enum.list,
  reply: "Here is a starter list.",
};
const curateValue = { rationales: {} as Record<string, string> };

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.responses = [];
  state.idx = 0;
});

describe("chat → pdf flow", () => {
  it("builds a list via /api/chat, then renders that same list to a PDF via /api/pdf", async () => {
    state.responses = [routerListValue, curateValue];

    const chatRes = await chatPost(
      jsonRequest("http://localhost/api/chat", {
        messages: [{ role: ChatRole.enum.counselor, content: "3.9 GPA, loves CS, open anywhere" }],
        profile: null,
      })
    );
    expect(chatRes.status).toBe(200);
    const data = (await chatRes.json()) as ChatResponse;
    expect(data.list).not.toBeNull();
    expect(data.list!.colleges.length).toBeGreaterThan(0);

    // The list is dataset-backed, so its ids pass /api/pdf integrity and render.
    const pdfRes = await pdfPost(jsonRequest("http://localhost/api/pdf", { list: data.list }));
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers.get("Content-Type")).toBe("application/pdf");
    const buffer = Buffer.from(await pdfRes.arrayBuffer());
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
  });
});
