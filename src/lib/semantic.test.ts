import { describe, it, expect } from "vitest";
import { buildSemanticContext } from "./semantic";
import type { EmbeddingProvider } from "./embeddings-provider";

const okEmbedder = (): EmbeddingProvider => ({
  async embed(texts) {
    return texts.map(() => new Float32Array([1, 0]));
  },
});

const throwingEmbedder = (): EmbeddingProvider => ({
  async embed() {
    throw new Error("upstream 429");
  },
});

const vectors = new Map<string, Float32Array>([["c1", new Float32Array([1, 0])]]);

describe("buildSemanticContext", () => {
  it("returns null when there are no interests (no embed call)", async () => {
    const ctx = await buildSemanticContext([], okEmbedder(), vectors);
    expect(ctx).toBeNull();
  });

  it("returns a context with one interest vector per interest", async () => {
    const ctx = await buildSemanticContext(["coding", "pre-med"], okEmbedder(), vectors);
    expect(ctx?.interestVectors).toHaveLength(2);
    expect(ctx?.collegeVectors).toBe(vectors);
  });

  it("returns null when the embedder throws (graceful fallback)", async () => {
    const ctx = await buildSemanticContext(["coding"], throwingEmbedder(), vectors);
    expect(ctx).toBeNull();
  });

  it("returns null when the embedder returns the wrong count", async () => {
    const bad: EmbeddingProvider = { async embed() { return []; } };
    const ctx = await buildSemanticContext(["coding"], bad, vectors);
    expect(ctx).toBeNull();
  });
});
