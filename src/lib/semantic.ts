/**
 * Request-time bridge: embed the student's interests and assemble a
 * `SemanticContext` for the matching engine. Any failure (embed error, wrong
 * count, empty interests) returns `null` so the caller falls back to
 * keyword-only matching. Framework-free; does no logging (the caller decides how
 * to surface the fallback).
 */
import type { SemanticContext } from "./matching";
import type { EmbeddingProvider } from "./embeddings-provider";

export async function buildSemanticContext(
  interests: string[],
  embedder: EmbeddingProvider,
  collegeVectors: Map<string, Float32Array>
): Promise<SemanticContext | null> {
  if (interests.length === 0) return null;
  try {
    const interestVectors = await embedder.embed(interests);
    if (interestVectors.length !== interests.length) return null;
    return { interestVectors, collegeVectors };
  } catch {
    return null;
  }
}
