/**
 * Embedding math + the program-document definition. Pure and dependency-light
 * (only Node `Buffer` for base64). No AI SDK here — the matching engine imports
 * `cosine`/`calibrate` from this file, so it must stay free of network/LLM deps.
 *
 * Vectors are L2-normalized at generation time, so at runtime cosine could be a
 * bare dot product; `cosine` still divides by magnitudes to stay correct for
 * un-normalized inputs (e.g. test fixtures).
 */

/** Embedding model + output dimensionality (single source; used by sync + loader). */
export const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIM = 256;

/** Cosine-similarity calibration band: at/below FLOOR -> 0, at/above CEIL -> 1. */
export const SEMANTIC_FLOOR = 0.55;
export const SEMANTIC_CEIL = 0.8;

/** Scale a vector to unit length; a zero vector is returned unchanged. */
export function l2normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i += 1) {
    const x = v[i] ?? 0;
    sum += x * x;
  }
  const norm = Math.sqrt(sum);
  if (norm === 0) return v;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i += 1) out[i] = (v[i] ?? 0) / norm;
  return out;
}

/** Cosine similarity of two equal-length vectors; 0 if either has zero magnitude. */
export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Map a raw cosine into a 0..1 fit signal across [SEMANTIC_FLOOR, SEMANTIC_CEIL]. */
export function calibrate(cos: number): number {
  const t = (cos - SEMANTIC_FLOOR) / (SEMANTIC_CEIL - SEMANTIC_FLOOR);
  return Math.max(0, Math.min(1, t));
}

/** Base64-encode a Float32Array (compact artifact storage). */
export function encodeVector(v: Float32Array): string {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64");
}

/** Decode a base64 Float32Array, copying into an aligned buffer first. */
export function decodeVector(s: string): Float32Array {
  const buf = Buffer.from(s, "base64");
  const copy = new Uint8Array(buf.length);
  copy.set(buf);
  return new Float32Array(copy.buffer);
}

/** The text embedded per college: its program labels joined. Single source of truth. */
export function programDocument(programs: string[]): string {
  return programs.join(", ");
}
