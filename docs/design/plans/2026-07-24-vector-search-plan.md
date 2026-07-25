# Vector Search (Semantic Program Matching) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add semantic (embedding + cosine) similarity as an augmentation of the existing keyword `programComponent`, so a student's interests match related college programs even when the words differ.

**Architecture:** College program-mix vectors are precomputed at sync time into a committed base64 artifact. At request time the route embeds the student's interests, loads the college vectors, and passes both to `buildList` as an optional `SemanticContext`. Scoring stays synchronous and deterministic; `programComponent` blends `max(exact-keyword, calibrated-cosine)` per interest. On empty interests / missing key / embed error the context is `null` and behavior is exactly today's keyword-only path.

**Tech Stack:** Next.js 16 App Router, TypeScript (strict + `noUncheckedIndexedAccess`), Vitest, Vercel AI SDK (`ai` `embedMany`), `@ai-sdk/google` `gemini-embedding-001` at 256 dims.

**Spec:** `docs/design/2026-07-24-vector-search-design.md`

## Global Constraints

- **Framework-free lib modules** — no imports from Next/React in `src/lib/*`.
- **No magic numbers/strings** — every threshold, dimension, model id, and log string is a named `const`, referenced by name at call sites.
- **Pure matching engine** — `matching.ts` stays free of network, LLM, randomness, and `Date`; the semantic math it imports (`cosine`, `calibrate`) is pure and pulls in no AI SDK.
- **Augment-only** — do NOT change any component weight (`W_PROGRAM`, `W_CONSTRAINTS`, `W_AID`, `W_WIDEN`), `rankScore`, the `W_ADMIT`/`W_FIT`/`W_PRESTIGE` blend, `admitChance`, or `prestige`. The only scoring change is inside `programComponent`.
- **Offline tests** — the whole suite runs with no network and no API key. Tests use injected fake vectors/embedders or the committed artifact; they never call the embedding API.
- **Embedding format** — model `gemini-embedding-001`, `outputDimensionality: 256`, vectors L2-normalized at generation, stored base64 `Float32Array`.
- **`noUncheckedIndexedAccess`** — guard every array / typed-array index access (`a[i] ?? 0`, `if (v)`), since indexed reads are `T | undefined`.
- **Public/portfolio repo** — no references to other codebases or companies anywhere. Commits are small and conventional; **no `Co-Authored-By: Claude` trailer**.
- **Gate** — `npm run check` (lint + typecheck + test + build) is green before any task is considered done.

---

### Task 1: Embedding math + document helper (`embeddings.ts`)

Pure, dependency-light (only Node `Buffer`). No AI SDK here — this file is safe for `matching.ts` to import.

**Files:**
- Create: `src/lib/embeddings.ts`
- Test: `src/lib/embeddings.test.ts`

**Interfaces:**
- Produces: `EMBEDDING_MODEL: string` (`"gemini-embedding-001"`), `EMBEDDING_DIM: number` (`256`), `SEMANTIC_FLOOR: number` (`0.55`), `SEMANTIC_CEIL: number` (`0.80`); `l2normalize(v: Float32Array): Float32Array`; `cosine(a: Float32Array, b: Float32Array): number`; `calibrate(cos: number): number`; `encodeVector(v: Float32Array): string`; `decodeVector(s: string): Float32Array`; `programDocument(programs: string[]): string`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/embeddings.test.ts
import { describe, it, expect } from "vitest";
import {
  l2normalize,
  cosine,
  calibrate,
  encodeVector,
  decodeVector,
  programDocument,
  SEMANTIC_FLOOR,
  SEMANTIC_CEIL,
} from "./embeddings";

describe("l2normalize", () => {
  it("scales a vector to unit length", () => {
    const n = l2normalize(new Float32Array([3, 4]));
    expect(Math.hypot(n[0] ?? 0, n[1] ?? 0)).toBeCloseTo(1, 6);
  });
  it("leaves a zero vector unchanged (no divide-by-zero)", () => {
    const n = l2normalize(new Float32Array([0, 0]));
    expect([...n]).toEqual([0, 0]);
  });
});

describe("cosine", () => {
  it("is 1 for identical direction and 0 for orthogonal", () => {
    expect(cosine(new Float32Array([1, 0]), new Float32Array([2, 0]))).toBeCloseTo(1, 6);
    expect(cosine(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0, 6);
  });
  it("returns 0 when either vector is zero", () => {
    expect(cosine(new Float32Array([0, 0]), new Float32Array([1, 1]))).toBe(0);
  });
});

describe("calibrate", () => {
  it("maps at/below floor to 0 and at/above ceil to 1", () => {
    expect(calibrate(SEMANTIC_FLOOR)).toBe(0);
    expect(calibrate(SEMANTIC_FLOOR - 0.2)).toBe(0);
    expect(calibrate(SEMANTIC_CEIL)).toBe(1);
    expect(calibrate(SEMANTIC_CEIL + 0.2)).toBe(1);
  });
  it("maps the midpoint to 0.5", () => {
    expect(calibrate((SEMANTIC_FLOOR + SEMANTIC_CEIL) / 2)).toBeCloseTo(0.5, 6);
  });
});

describe("encodeVector / decodeVector", () => {
  it("round-trips a Float32Array exactly", () => {
    const v = new Float32Array([0.5, -0.25, 0.125, 0]);
    const back = decodeVector(encodeVector(v));
    expect([...back]).toEqual([...v]);
  });
});

describe("programDocument", () => {
  it("joins program labels with a comma and space", () => {
    expect(programDocument(["Computer Science", "Engineering"])).toBe("Computer Science, Engineering");
  });
  it("returns an empty string for no programs", () => {
    expect(programDocument([])).toBe("");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/embeddings.test.ts`
Expected: FAIL — `Cannot find module './embeddings'`.

- [ ] **Step 3: Implement `embeddings.ts`**

```ts
// src/lib/embeddings.ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/embeddings.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Run the gate**

Run: `npm run check`
Expected: lint + typecheck + test + build all green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/embeddings.ts src/lib/embeddings.test.ts
git commit -m "feat: add embedding math and program-document helper"
```

---

### Task 2: Embedding provider seam (`embeddings-provider.ts`)

Thin adapter over the AI SDK, mirroring `llm.ts`'s `createProvider`/`getProvider` split. Like `llm.ts`, the wrapper itself has no bespoke unit test — it is typecheck-verified here and exercised via a mock in Task 6. Embeddings always use Google (independent of the configured chat provider).

**Files:**
- Create: `src/lib/embeddings-provider.ts`

**Interfaces:**
- Consumes: `EMBEDDING_MODEL`, `EMBEDDING_DIM`, `l2normalize` from `./embeddings`; `resolveSecret` from `./secrets`; `PROVIDER_DEFAULTS` from `./config`.
- Produces: `interface EmbeddingProvider { embed(texts: string[]): Promise<Float32Array[]> }`; `createEmbeddingProvider(model): EmbeddingProvider`; `getEmbeddingProvider(): EmbeddingProvider`.

- [ ] **Step 1: Implement `embeddings-provider.ts`**

```ts
// src/lib/embeddings-provider.ts
/**
 * Provider seam for embeddings, over the Vercel AI SDK's `embedMany`.
 * Framework-free. Mirrors `llm.ts`: `createEmbeddingProvider` wraps a concrete
 * model (the testable seam — Task 6 injects a fake); `getEmbeddingProvider`
 * resolves the Google embedding model with an explicitly-passed API key.
 *
 * Embeddings always use Google's `gemini-embedding-001`, independent of the
 * configured chat provider. Results are L2-normalized so downstream cosine is a
 * plain dot product.
 */
import { embedMany, type EmbeddingModel } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { resolveSecret } from "./secrets";
import { PROVIDER_DEFAULTS } from "./config";
import { EMBEDDING_MODEL, EMBEDDING_DIM, l2normalize } from "./embeddings";

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<Float32Array[]>;
}

/** Wrap a concrete AI-SDK embedding model as an EmbeddingProvider (testable seam). */
export function createEmbeddingProvider(model: EmbeddingModel<string>): EmbeddingProvider {
  return {
    async embed(texts: string[]): Promise<Float32Array[]> {
      if (texts.length === 0) return [];
      const { embeddings } = await embedMany({ model, values: texts });
      return embeddings.map((e) => l2normalize(Float32Array.from(e)));
    },
  };
}

/** Resolve the Google embedding model (key from env -> Keychain) into a provider. */
export function getEmbeddingProvider(): EmbeddingProvider {
  const keyEnvVar = PROVIDER_DEFAULTS.google.apiKeyEnvVar;
  const apiKey = resolveSecret(keyEnvVar);
  if (!apiKey) {
    throw new Error(
      `Missing Google API key for embeddings: set ${keyEnvVar} as an env var, or add it to the ` +
        `macOS Keychain — security add-generic-password -a "$USER" -s ${keyEnvVar} -w '<key>'`
    );
  }
  const model = createGoogleGenerativeAI({ apiKey }).textEmbeddingModel(EMBEDDING_MODEL, {
    outputDimensionality: EMBEDDING_DIM,
  });
  return createEmbeddingProvider(model);
}
```

> Note: if the AI SDK's exported type is named differently in this version (e.g. `EmbeddingModelV2<string>`), import that name — it is the type returned by `.textEmbeddingModel(...)`. Confirm via typecheck.

- [ ] **Step 2: Verify it typechecks and builds**

Run: `npm run typecheck && npm run build`
Expected: no errors (the file is unused at runtime until Task 6, but must compile).

- [ ] **Step 3: Run the gate**

Run: `npm run check`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add src/lib/embeddings-provider.ts
git commit -m "feat: add embedding provider seam (Google gemini-embedding-001)"
```

---

### Task 3: Sync script + placeholder artifact (`sync-embeddings.ts`)

Writes the generator and commits an **empty-but-valid** artifact so downstream modules import and tests pass offline. The real vectors are generated in Task 8 (needs the API key).

**Files:**
- Create: `scripts/sync-embeddings.ts`
- Create: `src/data/colleges.embeddings.json` (placeholder — empty `vectors`)
- Modify: `package.json` (add `sync:embeddings` script)

**Interfaces:**
- Consumes: `loadColleges` from `../src/lib/dataset`; `programDocument`, `encodeVector`, `EMBEDDING_MODEL`, `EMBEDDING_DIM` from `../src/lib/embeddings`; `getEmbeddingProvider` from `../src/lib/embeddings-provider`.

- [ ] **Step 1: Create the placeholder artifact**

```json
{ "model": "gemini-embedding-001", "dim": 256, "vectors": {} }
```

Save as `src/data/colleges.embeddings.json` (a single line + trailing newline). Empty `vectors` ⇒ every college scores keyword-only ⇒ identical to today ⇒ the suite stays green with no key.

- [ ] **Step 2: Implement `scripts/sync-embeddings.ts`**

```ts
// scripts/sync-embeddings.ts
/**
 * One-time sync: embed each college's program document and write
 * `src/data/colleges.embeddings.json`. Run with `npm run sync:embeddings`.
 *
 * Separate from `sync-scorecard.ts` so embeddings can be regenerated without
 * re-fetching the API. Requires the Google API key (env -> macOS Keychain),
 * used only here at sync time — never at runtime.
 *
 * Calibration note: `SEMANTIC_FLOOR`/`SEMANTIC_CEIL` in `src/lib/embeddings.ts`
 * are educated defaults. After a run, eyeball a few real interest->program
 * cosine values (e.g. "coding" vs a CS-heavy school) and nudge the band there.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadColleges } from "../src/lib/dataset";
import {
  programDocument,
  encodeVector,
  EMBEDDING_MODEL,
  EMBEDDING_DIM,
} from "../src/lib/embeddings";
import { getEmbeddingProvider } from "../src/lib/embeddings-provider";

const BATCH = 100;

async function main() {
  const colleges = loadColleges().filter((c) => c.programs.length > 0);
  const embedder = getEmbeddingProvider();
  const vectors: Record<string, string> = {};

  for (let i = 0; i < colleges.length; i += BATCH) {
    const chunk = colleges.slice(i, i + BATCH);
    const docs = chunk.map((c) => programDocument(c.programs));
    const embs = await embedder.embed(docs);
    chunk.forEach((c, j) => {
      const v = embs[j];
      if (v) vectors[c.id] = encodeVector(v);
    });
    console.log(`  embedded ${Math.min(i + BATCH, colleges.length)}/${colleges.length}`);
  }

  const artifact = { model: EMBEDDING_MODEL, dim: EMBEDDING_DIM, vectors };
  const out = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "src",
    "data",
    "colleges.embeddings.json"
  );
  writeFileSync(out, `${JSON.stringify(artifact)}\n`);
  console.log(`Wrote ${Object.keys(vectors).length} vectors to ${out}.`);
}

void main();
```

- [ ] **Step 3: Add the npm script**

In `package.json` `scripts`, after `"sync:scorecard"`, add:

```json
"sync:embeddings": "tsx scripts/sync-embeddings.ts",
```

- [ ] **Step 4: Run the gate**

Run: `npm run check`
Expected: green (script compiles; placeholder artifact imports cleanly; no behavior change).

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-embeddings.ts src/data/colleges.embeddings.json package.json package-lock.json
git commit -m "feat: add sync-embeddings script and placeholder artifact"
```

---

### Task 4: Artifact loader (`embeddings-data.ts`)

**Files:**
- Create: `src/lib/embeddings-data.ts`
- Test: `src/lib/embeddings-data.test.ts`

**Interfaces:**
- Consumes: `decodeVector`, `encodeVector`, `EMBEDDING_MODEL`, `EMBEDDING_DIM` from `./embeddings`; the committed `../data/colleges.embeddings.json`.
- Produces: `interface EmbeddingArtifact { model: string; dim: number; vectors: Record<string, string> }`; `parseArtifact(a: EmbeddingArtifact): Map<string, Float32Array>`; `loadCollegeVectors(): Map<string, Float32Array>`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/embeddings-data.test.ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/embeddings-data.test.ts`
Expected: FAIL — `Cannot find module './embeddings-data'`.

- [ ] **Step 3: Implement `embeddings-data.ts`**

```ts
// src/lib/embeddings-data.ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/embeddings-data.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the gate**

Run: `npm run check`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/embeddings-data.ts src/lib/embeddings-data.test.ts
git commit -m "feat: add college-embeddings artifact loader"
```

---

### Task 5: Blend semantic similarity into `programComponent` (`matching.ts`)

Thread an optional `SemanticContext` through `buildList -> fitScore -> programComponent`. Default `null` keeps every existing caller (and test) byte-identical.

**Files:**
- Modify: `src/lib/matching.ts` (imports ~15-24; `programComponent` ~270-283; `fitScore` ~334-341; `buildList` ~383-408)
- Test: `src/lib/matching.test.ts` (add a `describe("fitScore semantic")` block)

**Interfaces:**
- Consumes: `cosine`, `calibrate` from `./embeddings`.
- Produces: `interface SemanticContext { interestVectors: Float32Array[]; collegeVectors: Map<string, Float32Array> }`; updated `fitScore(profile, c, semantic?: SemanticContext | null)`; updated `buildList(profile, colleges, semantic?: SemanticContext | null)`.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/matching.test.ts` (the `college(...)` factory and `profile(...)` helper already exist):

```ts
import type { SemanticContext } from "./matching";

// A semantic context that makes one interest vector identical to one college's
// vector (cosine 1 -> calibrate 1) and orthogonal for a "weak" case.
function unit(x: number, y: number): Float32Array {
  return new Float32Array([x, y]);
}

describe("fitScore (semantic augmentation)", () => {
  it("boosts a synonym interest that has no keyword overlap", () => {
    const c = college({ id: "bio-u", programs: ["Biology"] });
    const student = profile({ interests: ["pre-med"] }); // no keyword match to "Biology"
    const semantic: SemanticContext = {
      interestVectors: [unit(1, 0)],
      collegeVectors: new Map([["bio-u", unit(1, 0)]]), // identical -> cosine 1
    };
    expect(fitScore(student, c, semantic)).toBeGreaterThan(fitScore(student, c, null));
  });

  it("null semantic reproduces the keyword-only score", () => {
    const c = college({ id: "bio-u", programs: ["Biology"] });
    const student = profile({ interests: ["pre-med"] });
    expect(fitScore(student, c, null)).toBe(fitScore(student, c));
  });

  it("keeps an exact keyword match at full credit despite weak similarity", () => {
    const c = college({ id: "bio-u", programs: ["Biology"] });
    const student = profile({ interests: ["Biology"] }); // exact keyword hit
    const semantic: SemanticContext = {
      interestVectors: [unit(0, 1)],
      collegeVectors: new Map([["bio-u", unit(1, 0)]]), // orthogonal -> cosine 0
    };
    // keyword already yields 1 for this interest, so max(1, 0) === keyword-only.
    expect(fitScore(student, c, semantic)).toBe(fitScore(student, c, null));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/matching.test.ts -t "semantic augmentation"`
Expected: FAIL — `SemanticContext` is not exported / `fitScore` takes 2 args.

- [ ] **Step 3: Add the import and `SemanticContext` type**

In `src/lib/matching.ts`, extend the top imports and add the type near the other exported shapes:

```ts
import { cosine, calibrate } from "./embeddings";
```

```ts
/**
 * Request-scoped semantic inputs. `interestVectors` is aligned by index with
 * `profile.interests`; `collegeVectors` maps college id -> its program vector.
 * `null` anywhere downstream means keyword-only (no embeddings available).
 */
export interface SemanticContext {
  interestVectors: Float32Array[];
  collegeVectors: Map<string, Float32Array>;
}
```

- [ ] **Step 4: Rewrite `programComponent` to blend keyword with semantic**

Replace the existing `programComponent` with:

```ts
/**
 * Fraction of the student's interests the school is strong in (0..1); neutral if
 * none. Per interest, the score is `max(exact-keyword hit, calibrated cosine)` —
 * semantic similarity can only RAISE a score the keyword match missed, so exact
 * matches stay authoritative. Keyword-only when `semantic` is null or the college
 * has no vector.
 */
function programComponent(profile: StudentProfile, c: College, semantic: SemanticContext | null): number {
  if (profile.interests.length === 0) return NEUTRAL;
  const schoolPhrases = c.programs;
  const schoolTokens = new Set<string>();
  for (const phrase of schoolPhrases) {
    for (const token of tokenize(phrase)) schoolTokens.add(token);
  }
  const collegeVec = semantic?.collegeVectors.get(c.id) ?? null;

  let total = 0;
  for (let i = 0; i < profile.interests.length; i += 1) {
    const interest = profile.interests[i] ?? "";
    const keyword = interestMatches(interest, schoolPhrases, schoolTokens) ? 1 : 0;
    let sem = 0;
    const interestVec = semantic?.interestVectors[i] ?? null;
    if (collegeVec !== null && interestVec != null) {
      sem = calibrate(cosine(interestVec, collegeVec));
    }
    total += Math.max(keyword, sem);
  }
  return total / profile.interests.length;
}
```

- [ ] **Step 5: Thread `semantic` through `fitScore` and `buildList`**

Update `fitScore` (default `null` so existing 2-arg callers are unchanged):

```ts
export function fitScore(
  profile: StudentProfile,
  c: College,
  semantic: SemanticContext | null = null
): number {
  return (
    programComponent(profile, c, semantic) * W_PROGRAM +
    constraintComponent(profile, c) * W_CONSTRAINTS +
    aidComponent(profile, c) * W_AID +
    widenComponent(c) * W_WIDEN
  );
}
```

Update `buildList` signature and the one `fitScore` call inside its `.map`:

```ts
export function buildList(
  profile: StudentProfile,
  colleges: College[],
  semantic: SemanticContext | null = null
): CollegeList {
```

```ts
      fitScore: fitScore(profile, c, semantic),
```

(Leave `admitChance`, `rankScore`, `prestige`, and every weight untouched.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/lib/matching.test.ts`
Expected: PASS — the new semantic block passes and all pre-existing matching tests still pass (they pass `null` implicitly).

- [ ] **Step 7: Run the gate**

Run: `npm run check`
Expected: green.

- [ ] **Step 8: Commit**

```bash
git add src/lib/matching.ts src/lib/matching.test.ts
git commit -m "feat: blend semantic similarity into programComponent"
```

---

### Task 6: Request-time wiring — semantic context + route (`semantic.ts`, `route.ts`)

Factor the "embed interests -> build context, swallowing failure" logic into a small, directly-testable helper, then wire it into the route's `list` branch with a progress step.

**Files:**
- Create: `src/lib/semantic.ts`
- Test: `src/lib/semantic.test.ts`
- Modify: `src/app/api/chat/route.ts` (imports ~16-31; step consts ~61-62; `list` case ~218-227)
- Test: `src/app/api/chat/route.test.ts`

**Interfaces:**
- Consumes: `SemanticContext` from `./matching`; `EmbeddingProvider` from `./embeddings-provider`.
- Produces: `buildSemanticContext(interests: string[], embedder: EmbeddingProvider, collegeVectors: Map<string, Float32Array>): Promise<SemanticContext | null>`.

- [ ] **Step 1: Write the failing tests for `buildSemanticContext`**

```ts
// src/lib/semantic.test.ts
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/semantic.test.ts`
Expected: FAIL — `Cannot find module './semantic'`.

- [ ] **Step 3: Implement `semantic.ts`**

```ts
// src/lib/semantic.ts
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
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/lib/semantic.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the route**

In `src/app/api/chat/route.ts`:

Add imports (after the existing `@/lib/*` imports):

```ts
import { getEmbeddingProvider } from "@/lib/embeddings-provider";
import { loadCollegeVectors } from "@/lib/embeddings-data";
import { buildSemanticContext } from "@/lib/semantic";
import type { SemanticContext } from "@/lib/matching";
```

Add a step-label const next to `STEP_READ_PROFILE`:

```ts
const STEP_SEMANTIC = "Matched programs semantically";
```

Add a small resolver above `POST` (getEmbeddingProvider throws on a missing key; swallow it):

```ts
/** Build the semantic context, returning null on any failure (missing key, embed error). */
async function resolveSemantic(interests: string[]): Promise<SemanticContext | null> {
  try {
    return await buildSemanticContext(interests, getEmbeddingProvider(), loadCollegeVectors());
  } catch {
    return null;
  }
}
```

Update the `ChatAction.enum.list` case to build the context, pass it to `buildList`, and record the step only when semantic is active:

```ts
      case ChatAction.enum.list: {
        const dataset = loadColleges();
        const semantic = await resolveSemantic(routed.profile.interests);
        const base = buildList(routed.profile, dataset, semantic);
        list = await withResilience(STAGE_CURATE, () =>
          curate({ llm: provider, profile: routed.profile, list: base })
        );
        steps.push(STEP_READ_PROFILE);
        if (semantic !== null) steps.push(STEP_SEMANTIC);
        steps.push(`Ranked ${dataset.length} colleges by admission chance and fit`);
        steps.push(`Wrote admission notes for the top ${list.colleges.length}`);
        break;
      }
```

- [ ] **Step 6: Write the route integration test**

```ts
// src/app/api/chat/route.test.ts
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
```

> This test filename ends in `.test.ts`, so `npm run test:unit`'s `--exclude '**/*.integration.test.*'` keeps it in the unit run.

- [ ] **Step 7: Run the route + semantic tests**

Run: `npx vitest run src/app/api/chat/route.test.ts src/lib/semantic.test.ts`
Expected: PASS — semantic step present on success; a rejected embed still yields a 200 with a non-null list and no semantic step.

- [ ] **Step 8: Run the gate**

Run: `npm run check`
Expected: green.

- [ ] **Step 9: Commit**

```bash
git add src/lib/semantic.ts src/lib/semantic.test.ts src/app/api/chat/route.ts src/app/api/chat/route.test.ts
git commit -m "feat: wire request-time semantic matching into the chat route"
```

---

### Task 7: Documentation

Update the three docs the spec names as deliverables. No code, no tests — verified by review + the gate (Markdown doesn't affect it, but run it to confirm nothing else drifted).

**Files:**
- Modify: `README.md` (Highlights list; "How it works" pipeline line)
- Modify: `docs/architecture.md` (request-flow section; components section; "Key decisions at a glance")
- Modify: `.codex/implementation-rules.md` (add an embeddings/artifact conventions entry)

- [ ] **Step 1: Update `README.md`**

- In **Highlights**, add a bullet after the "Data-driven" one:

```markdown
- **Semantic program matching** — a student's interests match relevant college
  programs even when the words differ ("coding" → *Computer Science*, "pre-med" →
  *Biology*), via embeddings blended into the deterministic fit score. Exact matches
  always still count; semantic only adds recall, and the ranking stays reproducible.
```

- In **How it works**, change the pipeline block to note the request-time embed:

```
description → de-identify → extract profile (LLM) → embed interests
           → match dataset (deterministic; keyword + semantic) → curate rationale (LLM)
           → ranked list → PDF
```

- [ ] **Step 2: Update `docs/architecture.md`**

- In the **request flow** section, add the embed step where the list is built: after profile extraction / before `buildList`, note "the route embeds the student's interests (`gemini-embedding-001`, 256-dim) and loads the committed college vectors; on any failure it falls back to keyword-only, logged as a step."
- In the **components** section, add: `embeddings.ts` (pure math + program document), `embeddings-provider.ts` (Google embedding seam), `embeddings-data.ts` (artifact loader), `semantic.ts` (request-time context builder), and the `scripts/sync-embeddings.ts` generator + `src/data/colleges.embeddings.json` artifact.
- In **Key decisions at a glance**, add three rows:
  - *Semantic search augments program-fit only* — embeddings never enter `rankScore`; admit-chance and prestige stay deterministic.
  - *College vectors precomputed + committed* — runtime needs no key for the college side; results are reproducible.
  - *No vector DB* — ~1,500 × 256-dim in-memory cosine is trivial; an index/DB is unwarranted.

- [ ] **Step 3: Update `.codex/implementation-rules.md`**

Add a short rule entry consistent with the file's existing style, capturing:
- Embeddings use `gemini-embedding-001` at 256 dims; vectors are L2-normalized and stored as base64 `Float32Array` in `src/data/colleges.embeddings.json`.
- The pure math (`cosine`, `calibrate`, base64, `programDocument`) lives in `embeddings.ts` with no AI-SDK import, so the matching engine can import it and stay pure; the provider seam is isolated in `embeddings-provider.ts`.
- Calibration band (`SEMANTIC_FLOOR`/`SEMANTIC_CEIL`) is the single tuning point; semantic augments `programComponent` only and never changes weights or `rankScore`.
- Request path falls back to keyword-only on empty interests / missing key / embed error.

- [ ] **Step 4: Run the gate**

Run: `npm run check`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/architecture.md .codex/implementation-rules.md
git commit -m "docs: document semantic program matching"
```

---

### Task 8: Generate & commit the production artifact

Activation step. Requires the Google API key (env or macOS Keychain). If the executing agent lacks the key, the controller runs this and commits the artifact.

**Files:**
- Modify: `src/data/colleges.embeddings.json` (placeholder → real vectors)

- [ ] **Step 1: Generate the artifact**

Run: `npm run sync:embeddings`
Expected: console shows `embedded N/N` progress and `Wrote ~1500 vectors`. The command needs `GOOGLE_GENERATIVE_AI_API_KEY` (env or Keychain).

- [ ] **Step 2: Spot-check the output**

- Confirm the file header is `"model":"gemini-embedding-001","dim":256`.
- Confirm `Object.keys(vectors).length` is close to the number of colleges with ≥1 program (~1,500).
- Optional: eyeball a couple of interest→program cosines and, if the calibration band looks off, adjust `SEMANTIC_FLOOR`/`SEMANTIC_CEIL` in `embeddings.ts` (a one-line change; re-run the gate).

- [ ] **Step 3: Run the gate**

Run: `npm run check`
Expected: green (the real artifact parses; loader caps nothing; tests use fixtures so they're unaffected).

- [ ] **Step 4: Commit**

```bash
git add src/data/colleges.embeddings.json
git commit -m "chore: generate production college embeddings artifact"
```

---

## Notes for the executor

- **Dependency order matters:** Task 4's module `import`s `colleges.embeddings.json`, which Task 3 creates as a placeholder — do not reorder 3 and 4.
- **The gate stays green at every task, offline, with no key.** The empty placeholder artifact means semantic matching is a no-op until Task 8, but all code paths, types, and tests are exercised via fixtures and the empty map.
- **After Task 8 the feature is live.** Before it, the app behaves exactly as it does today (keyword-only) — which is the intended graceful-degradation floor.
