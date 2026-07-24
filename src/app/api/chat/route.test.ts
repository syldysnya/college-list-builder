import { describe, it, expect, beforeEach, vi } from "vitest";
import { ChatAction, ChatRole, emptyProfile, type ChatResponse, type StudentProfile } from "@/lib/types";
import { STUDENT_PLACEHOLDER } from "@/lib/deidentify";
import { limits } from "@/lib/config";

/**
 * Shared, hoisted mock state. `vi.mock` factories run before module-level
 * `const`s, so the controllable state must be created via `vi.hoisted`.
 *   • `responses` — values `generateObject` returns, consumed in call order
 *     (router call first; on a `list` decision, the curate call second).
 *   • `calls`     — prompt/system captured from each `generateObject` call
 *     (used to assert the masked — never raw — text reached the model).
 *   • `throwsLeft`— how many leading calls should throw (retry/timeout paths).
 */
const state = vi.hoisted(() => ({
  responses: [] as unknown[],
  calls: [] as { prompt: string; system?: string }[],
  idx: 0,
  throwsLeft: 0,
}));

vi.mock("@/lib/llm", () => ({
  getProvider: () => ({
    async generateObject(o: { prompt: string; system?: string }) {
      state.calls.push({ prompt: o.prompt, system: o.system });
      if (state.throwsLeft > 0) {
        state.throwsLeft -= 1;
        throw new Error("mock LLM failure");
      }
      const value = state.responses[state.idx] ?? {};
      state.idx += 1;
      return { value, usage: { inputTokens: 0, outputTokens: 0 } };
    },
    generateText() {
      throw new Error("generateText not used by /api/chat");
    },
    streamText() {
      throw new Error("streamText not used by /api/chat");
    },
  }),
}));

// Import the route under test AFTER the mock is registered.
const { POST } = await import("./route");

function routerValue(o: {
  profile?: StudentProfile;
  action: ChatAction;
  reply?: string;
}) {
  return { profile: o.profile ?? emptyProfile(), action: o.action, reply: o.reply ?? "ok" };
}

const curateValue = { rationales: {} as Record<string, string> };

function chatRequest(body: unknown): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    messages: [{ role: ChatRole.enum.counselor, content: "She has a 3.9 GPA and loves CS." }],
    profile: null,
    list: null,
    clarifyingCount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  state.responses = [];
  state.calls = [];
  state.idx = 0;
  state.throwsLeft = 0;
});

describe("POST /api/chat", () => {
  it("returns a curated tiered list on a `list` decision", async () => {
    state.responses = [routerValue({ action: ChatAction.enum.list, reply: "Building it." }), curateValue];

    const res = await POST(chatRequest(validBody()));
    expect(res.status).toBe(200);

    const data = (await res.json()) as ChatResponse;
    expect(data.action).toBe(ChatAction.enum.list);
    expect(data.reply).toBe("Building it.");
    expect(data.list).not.toBeNull();
    expect(data.list!.reach.length).toBeGreaterThan(0);
    // Router + curate were both called.
    expect(state.calls).toHaveLength(2);
  });

  it("returns no list and preserves clarifyingCount on `refuse`", async () => {
    state.responses = [routerValue({ action: ChatAction.enum.refuse, reply: "Back to the list." })];

    const res = await POST(chatRequest(validBody({ clarifyingCount: 1 })));
    expect(res.status).toBe(200);

    const data = (await res.json()) as ChatResponse;
    expect(data.action).toBe(ChatAction.enum.refuse);
    expect(data.list).toBeNull();
    expect(data.clarifyingCount).toBe(1);
    // Only the router ran — no curate call.
    expect(state.calls).toHaveLength(1);
  });

  it("increments clarifyingCount and returns no list on `ask`", async () => {
    state.responses = [routerValue({ action: ChatAction.enum.ask, reply: "What are her interests?" })];

    const res = await POST(chatRequest(validBody({ clarifyingCount: 0 })));
    expect(res.status).toBe(200);

    const data = (await res.json()) as ChatResponse;
    expect(data.action).toBe(ChatAction.enum.ask);
    expect(data.list).toBeNull();
    expect(data.clarifyingCount).toBe(1);
  });

  it("400s a malformed body (missing messages)", async () => {
    const res = await POST(chatRequest({ profile: null, list: null, clarifyingCount: 0 }));
    expect(res.status).toBe(400);
    expect(state.calls).toHaveLength(0);
  });

  it("400s invalid JSON", async () => {
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("400s oversized input (content longer than maxInputChars)", async () => {
    const huge = "a".repeat(limits.maxInputChars + 1);
    const res = await POST(chatRequest(validBody({
      messages: [{ role: ChatRole.enum.counselor, content: huge }],
    })));
    expect(res.status).toBe(400);
    expect(state.calls).toHaveLength(0);
  });

  it("de-identifies before the LLM: masks the name, returns it to the client", async () => {
    state.responses = [routerValue({ action: ChatAction.enum.list, reply: "ok" }), curateValue];

    const res = await POST(chatRequest(validBody({
      messages: [{ role: ChatRole.enum.counselor, content: "I have a student named John Smith who loves CS." }],
    })));
    expect(res.status).toBe(200);

    const data = (await res.json()) as ChatResponse;
    expect(data.studentName).toBe("John Smith");

    // The router received masked text — the raw name never reached the model.
    const routerPrompt = state.calls[0]?.prompt ?? "";
    expect(routerPrompt).not.toContain("John Smith");
    expect(routerPrompt).toContain(STUDENT_PLACEHOLDER);
  });

  it("retries once then succeeds on a transient LLM throw", async () => {
    state.throwsLeft = 1;
    state.responses = [routerValue({ action: ChatAction.enum.list, reply: "ok" }), curateValue];

    const res = await POST(chatRequest(validBody()));
    expect(res.status).toBe(200);
    // 1 failed attempt + router + curate.
    expect(state.calls).toHaveLength(3);
  });

  it("500s (never a silent empty list) when the LLM keeps failing", async () => {
    state.throwsLeft = 99;
    state.responses = [routerValue({ action: ChatAction.enum.list, reply: "ok" })];

    const res = await POST(chatRequest(validBody()));
    expect(res.status).toBe(500);
    const data = (await res.json()) as { error: string };
    expect(data.error.length).toBeGreaterThan(0);
  });
});
