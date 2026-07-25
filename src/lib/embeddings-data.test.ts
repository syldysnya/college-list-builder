import { describe, it, expect } from "vitest";
import { parseArtifact, type EmbeddingArtifact } from "./embeddings-data";
import { encodeVector, EMBEDDING_MODEL, EMBEDDING_DIM } from "./embeddings";

function artifact(vectors: Record<string, string>, over: Partial<EmbeddingArtifact> = {}): EmbeddingArtifact {
  return { model: EMBEDDING_MODEL, dim: EMBEDDING_DIM, vectors, ...over };
}

describe("parseArtifact", () => {
  it("decodes each vector and keys it by college id", () => {
    const v = new Float32Array([0.1, 0.2, 0.3]);
    const map = parseArtifact(artifact({ "college-1": encodeVector(v) }));
    expect(map.has("college-1")).toBe(true);
    expect([...(map.get("college-1") ?? [])]).toEqual([...v]);
  });

  it("returns an empty map on a model mismatch", () => {
    const v = encodeVector(new Float32Array([1, 0]));
    const map = parseArtifact(artifact({ a: v }, { model: "some-other-model" }));
    expect(map.size).toBe(0);
  });

  it("returns an empty map on a dim mismatch", () => {
    const v = encodeVector(new Float32Array([1, 0]));
    const map = parseArtifact(artifact({ a: v }, { dim: 768 }));
    expect(map.size).toBe(0);
  });

  it("omits ids that are not present", () => {
    const map = parseArtifact(artifact({}));
    expect(map.get("missing")).toBeUndefined();
  });
});
