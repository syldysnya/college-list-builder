/**
 * Loads the committed college-embeddings artifact into a cached
 * `Map<collegeId, Float32Array>` (mirrors `dataset.ts` caching). A header
 * mismatch (wrong model/dim) disables semantic matching gracefully by returning
 * an empty map; an id absent from the map scores keyword-only.
 * Framework-free.
 */
import artifact from "../data/colleges.embeddings.json";
import { decodeVector, EMBEDDING_MODEL, EMBEDDING_DIM } from "./embeddings";

export interface EmbeddingArtifact {
  model: string;
  dim: number;
  vectors: Record<string, string>;
}

const LOG_PREFIX = "[embeddings-data]";

/** Decode an artifact into a vector map; empty on any header mismatch. */
export function parseArtifact(a: EmbeddingArtifact): Map<string, Float32Array> {
  const map = new Map<string, Float32Array>();
  if (a.model !== EMBEDDING_MODEL || a.dim !== EMBEDDING_DIM) {
    console.warn(`${LOG_PREFIX} artifact mismatch (model=${a.model}, dim=${a.dim}); semantic disabled`);
    return map;
  }
  for (const [id, b64] of Object.entries(a.vectors)) {
    map.set(id, decodeVector(b64));
  }
  return map;
}

let cache: Map<string, Float32Array> | null = null;

/** Cached college-vector map from the committed artifact. */
export function loadCollegeVectors(): Map<string, Float32Array> {
  if (cache === null) cache = parseArtifact(artifact as EmbeddingArtifact);
  return cache;
}
