# Vector Search (Semantic Program Matching) — Design Spec

**Date:** 2026-07-24
**Status:** Approved (brainstorm)
**Context:** Add true vector/semantic search to the deterministic matching engine so a
student's interests match relevant college programs even when the words differ
("coding" → *Computer Science*, "pre-med" → *Biology / Health & Nursing*).

---

## 1. Goal

Today `programComponent` matches a student's `interests` against a college's `programs`
by **exact keyword / substring / token overlap**. It misses synonyms and related
concepts: "coding" does not substring-match "Computer Science", "pre-med" does not match
"Biology". This costs real recall on the one part of fit that is about *what the student
wants to study*.

Add **semantic similarity** (embeddings + cosine) as an **augmentation** of that single
component. Nothing else in the ranking changes.

**Success criteria:**
- An interest with **no** keyword overlap but a clear semantic relationship to a
  college's programs raises that college's `programComponent` (and only that).
- Exact keyword matches still count fully (grounding preserved).
- The ranking blend (`admitChance`, `fitScore` weights, `prestige`, `rankScore`) is
  **byte-for-byte unchanged** when the semantic signal is absent.
- The build and the entire test suite run with **no network and no API key**.

## 2. Non-goals (YAGNI)

- **No new ranking term.** Semantic similarity feeds `programComponent` only — it never
  becomes its own weighted factor in `rankScore`. Admit-chance and prestige stay
  deterministic and reputation/selectivity-grounded.
- **No runtime re-embedding of colleges.** College vectors are precomputed once at sync
  time and committed. Only the student's query is embedded per request.
- **No vector database / ANN index.** ~1,500 colleges × 256 dims is a trivial in-memory
  scan (~1M multiply-adds per request). A DB or approximate index is unwarranted.
- **No narrative embedding.** Only the structured `interests` array is embedded on the
  student side (the narrative is noisy — constraints, scores, personality dilute the
  program signal).
- **No change to profile extraction, privacy de-identification, curation, or PDF.**

## 3. Approach chosen

One vector **per college** (the college's program mix as a short document) and one vector
**per student interest**, compared by cosine and blended into `programComponent` via
`max(keyword, calibrated-cosine)`. Rejected alternatives:

- **Weighted keyword+semantic blend** — a strong exact match can be dragged down by weak
  cosine and vice-versa; muddier to reason about than `max`, and weakens the grounding
  guarantee.
- **Semantic replaces keyword** — loses the guarantee that an exact program-name match
  always counts fully; makes results depend entirely on the embedding model.
- **Per-program-label embeddings (38 canonical CIP vectors)** — smaller and higher
  per-interest resolution, but does not match the "embed each college" framing and is
  really semantic keyword-expansion over a fixed vocabulary rather than document
  retrieval.

## 4. Architecture

The feature hangs off **one seam**: `programComponent` gains an optional semantic signal.

```
sync-scorecard.ts ─► colleges.json ─► sync-embeddings.ts ─► colleges.embeddings.json (committed)
                                                                      │
POST /api/chat ─► embed(interests) ─┐                                 │
                                    ▼                                 ▼
                    buildList(profile, colleges, SemanticContext | null) ─► ranked list
                                    │ (null on empty interests / no key / embed error → keyword-only)
```

**Build-time (manual, offline-friendly):** `scripts/sync-embeddings.ts`
(`npm run sync:embeddings`) reads `colleges.json`, builds a program document per college
(the `programs` joined by ", "), embeds all colleges via `text-embedding-004` at
`outputDimensionality: 256`, **L2-normalizes** each vector, and writes
`src/data/colleges.embeddings.json`. Separate from `sync-scorecard.ts` so embeddings can
be regenerated without re-fetching the API.

**Request-time (async route):**
1. Embed the student's `interests` (one vector each; same model, 256 dims, normalized) —
   a single `embedMany` call.
2. Load the committed college vectors (cached, decoded once).
3. Build a `SemanticContext` and pass it to `buildList`.
4. On empty interests, missing key, or any embed error → pass `null` → keyword-only
   fallback (today's behavior), logged as a progress step.

**Scoring (sync, pure, deterministic):** unchanged signature except an added optional
param. Same vectors → same scores.

## 5. Data model

### Artifact — `src/data/colleges.embeddings.json` (~2 MB, committed)

```jsonc
{
  "model": "text-embedding-004",
  "dim": 256,
  "vectors": {
    "<collegeId>": "<base64 of a 256-length Float32Array>",
    // ... one entry per college that has ≥1 program
  }
}
```

- Vectors are L2-normalized at generation time, so runtime cosine = dot product.
- Base64-encoded `Float32Array` keeps the file ~2 MB (vs ~5 MB plain-JSON arrays,
  ~15–20 MB at 768 dims).
- A college whose id is absent (no programs, or artifact staleness) scores keyword-only.

### `SemanticContext` (in-memory, request-scoped)

```ts
interface SemanticContext {
  interestVectors: Float32Array[];        // one per student interest, normalized
  collegeVectors: Map<string, Float32Array>; // id → normalized college vector
}
```

`buildList` / `fitScore` / `programComponent` take `semantic: SemanticContext | null`.
`null` ⇒ keyword-only.

## 6. Module breakdown

**New:**

- **`src/lib/embeddings.ts`** — math + provider seam.
  - `interface EmbeddingProvider { embed(texts: string[]): Promise<Float32Array[]> }`
  - `getEmbeddingProvider(cfg?): EmbeddingProvider` — wraps `@ai-sdk/google`
    `textEmbeddingModel("text-embedding-004")` with `{ outputDimensionality: 256 }`,
    using the same env→Keychain-resolved key path as `getLlmConfig`; normalizes results.
  - Pure helpers (no network, unit-tested): `l2normalize(v)`, `cosine(a, b)`,
    `calibrate(cos)`, `encodeVector(v): string` (base64), `decodeVector(s): Float32Array`.
  - Named consts: `EMBEDDING_MODEL = "text-embedding-004"`, `EMBEDDING_DIM = 256`,
    `SEMANTIC_FLOOR = 0.55`, `SEMANTIC_CEIL = 0.80`.
- **`src/lib/embeddings-data.ts`** — loads/decodes `colleges.embeddings.json` into a
  cached `Map<id, Float32Array>` (mirrors `dataset.ts` caching). Validates the header
  (`model`, `dim`); on mismatch, logs once and returns an empty map (→ keyword-only).
- **`scripts/sync-embeddings.ts`** — build-time generator (`npm run sync:embeddings`);
  batches `embed` calls, writes the artifact with a stable key order.
- **`src/data/colleges.embeddings.json`** — the committed artifact.

**Modified:**

- **`src/lib/matching.ts`** — add `SemanticContext`; thread optional `semantic` through
  `buildList` → `fitScore` → `programComponent`; add `SEMANTIC_FLOOR`/`SEMANTIC_CEIL`
  use (calibration lives in `embeddings.ts`). No weight changes.
- **`src/app/api/chat/route.ts`** — embed interests, load vectors, build context, pass
  it in; `try/catch` → `null` on failure; add a progress step
  (e.g. `"Matched programs semantically"`).
- **`package.json`** — add `"sync:embeddings": "tsx scripts/sync-embeddings.ts"`.

**Docs (required deliverables):**

- **`README.md`** — Highlights + "How it works" mention semantic program matching.
- **`docs/architecture.md`** — request flow (the request-time embed step), components
  (new modules), and "Key decisions at a glance" (why augment-only, why committed
  artifact, why no vector DB).
- **`.codex/implementation-rules.md`** — conventions for the embedding seam and artifact
  (normalized vectors, base64 Float32, named calibration consts, keyword-only fallback).

## 7. Scoring & calibration

**Document embedded per college:** the `programs` array joined with ", "
(e.g. *"Computer Science, Engineering, Mathematics"*). Majors only — not `type`/`name`.
No programs ⇒ no vector.

**Calibration** (`calibrate(cos) → 0..1`):

```
SEMANTIC_FLOOR = 0.55   // at/below → 0.0
SEMANTIC_CEIL  = 0.80   // at/above → 1.0
calibrate(cos) = clamp((cos - SEMANTIC_FLOOR) / (SEMANTIC_CEIL - SEMANTIC_FLOOR), 0, 1)
```

**Blend** inside `programComponent` (per interest, then averaged):

```
score(interest) = max( keywordHit(interest, programs) ? 1 : 0,
                       calibrate( cosine(vec(interest), collegeVector) ) )
programComponent = mean over interests of score(interest)
```

Strict superset of current behavior: an exact keyword hit still yields 1.0; semantic only
*raises* a score the keyword missed. `W_PROGRAM` and all other weights unchanged, so the
semantic signal moves a college only through the program slice of fit — never through
admit-chance or prestige.

**Calibration honesty:** the floor/ceiling defaults are educated guesses
(`text-embedding-004` short-text similarities cluster ~0.5 unrelated to ~0.85 strong).
They live as named consts in one place; after seeing live numbers on a few real
interest→program pairs, nudge them. A short note in the sync script comments explains how.

## 8. Error handling & resilience

Request path only (build and tests never embed):

- Empty `interests`, missing key, or any embed error → `catch` → `semantic = null` →
  keyword-only list. Logged as a step; never a 500.
- Artifact id not found for a college → that college scores keyword-only.
- Artifact `model`/`dim` header mismatch → logged once, semantic disabled for the request.

## 9. Testing

All offline — no key, no network.

- **`embeddings.ts` (pure units):** `cosine` (orthogonal→0, identical→1),
  `calibrate` (below floor→0, above ceil→1, midpoint→0.5), base64 round-trip
  (`decode(encode(v)) ≈ v`), `l2normalize` (‖v‖→1).
- **`matching.ts`:** with a hand-built `SemanticContext` (fake vectors), a synonym with
  **no** keyword overlap scores > 0; passing `null` reproduces today's exact scores
  (regression guard). Existing matching tests pass `null` implicitly → unchanged.
- **`embeddings-data.ts`:** a tiny fixture artifact loads and decodes; unknown id absent
  from the map; header mismatch → empty map.
- **`route.ts` integration:** mock the embedding provider (no real call); the semantic
  step appears on success; a thrown embed error still returns a keyword-only list (no
  500).
- The committed real artifact is **not** used by unit tests (fixtures only), so tests
  never depend on its freshness.

**Gate unchanged:** `npm run check` (lint + typecheck + test + build) is the green bar;
build needs neither key nor network.

## 10. Build sequence

1. `embeddings.ts` — pure helpers + provider seam (+ unit tests).
2. `embeddings-data.ts` — artifact loader/cache (+ fixture tests).
3. `scripts/sync-embeddings.ts` — generator; run it to produce the real artifact.
4. `matching.ts` — thread `SemanticContext` through; blend in `programComponent`
   (+ tests, including the `null` regression guard).
5. `route.ts` — embed interests, build context, fallback, progress step (+ integration
   test).
6. Docs — README, architecture.md, implementation-rules.md.

## 11. Configuration & scope decisions

- **Embedding model:** `text-embedding-004` via the existing `@ai-sdk/google` provider,
  256 output dims. Same key resolution (env → macOS Keychain) as the chat model.
- **Artifact committed** (not generated on deploy) so runtime needs no key for the
  college side and results are deterministic.
- **Augment `programComponent` only** — the deliberate boundary that keeps the grounded,
  reproducible ranking intact while fixing synonym recall.
