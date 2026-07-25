import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChatAction } from "@/lib/types";

// `vi.mock` factories are hoisted above top-level `const`s, so anything a
// factory references must come from `vi.hoisted` (not an ordinary const).
const { embedMock, routeProfile } = vi.hoisted(() => ({
  embedMock: vi.fn(),
  routeProfile: {
    name: null, gpa: null, sat: null, act: null, apScores: [], interests: ["coding"],
    constraints: {
      homeState: null, maxDistance: null, climate: "none", needsFinancialAid: false,
      size: "none", setting: "none", practicalHandsOn: false,
    },
    narrative: "",
  },
}));

// Mock every collaborator so POST runs offline and deterministically.
vi.mock("@/lib/deidentify", () => ({
  maskPII: (content: string) => ({ masked: content, name: null }),
}));
vi.mock("@/lib/llm", () => ({ getProvider: () => ({}) }));
vi.mock("@/lib/router", () => ({
  route: vi.fn(async () => ({ action: ChatAction.enum.list, reply: "Here is a list.", profile: routeProfile })),
}));
vi.mock("@/lib/curate", () => ({ curate: vi.fn(async (o: { list: unknown }) => o.list) }));
vi.mock("@/lib/dataset", () => ({ loadColleges: () => [] }));
vi.mock("@/lib/embeddings-data", () => ({ loadCollegeVectors: () => new Map() }));
vi.mock("@/lib/embeddings-provider", () => ({ getEmbeddingProvider: () => ({ embed: embedMock }) }));

async function postWith(): Promise<Response> {
  const { POST } = await import("./route");
  return POST(
    new Request("http://test/api/chat", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "counselor", content: "A student who loves coding." }], profile: null }),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  embedMock.mockImplementation(async (texts: string[]) => texts.map(() => new Float32Array([1, 0])));
});

describe("POST /api/chat — semantic step", () => {
  it("includes the semantic step when embedding succeeds", async () => {
    const res = await postWith();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.steps).toContain("Matched programs semantically");
  });

  it("still returns a list (no 500, no semantic step) when embedding fails", async () => {
    embedMock.mockRejectedValueOnce(new Error("upstream 429"));
    const res = await postWith();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.list).not.toBeNull();
    expect(body.steps).not.toContain("Matched programs semantically");
  });
});
