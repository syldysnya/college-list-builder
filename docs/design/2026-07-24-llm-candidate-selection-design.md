# LLM Candidate Selection (Grounded Re-Ranking) — Design Spec

**Date:** 2026-07-24
**Status:** Approved (brainstorm)
**Context:** The deterministic engine cannot surface schools known for reputational/soft
qualities that are not in the Scorecard dataset (co-op, hands-on, project-based). Let the
LLM choose the list from a grounded candidate pool, using knowledge the data lacks, without
ever inventing a school.

This is part **(B)** of the two-part list redesign. Part **(A)** — the selectivity spread,
geography-forward fit, and relevance-gated prestige — is a prerequisite; this builds on its
scoring.

---

## 1. Goal

A student who wants "practical, hands-on" computer science near Pennsylvania should see
**Drexel, RIT, Penn State, WPI** — schools famous for co-op and experiential learning. The
deterministic engine can't: "co-op / hands-on" is not a field in the Scorecard data, and the
per-college program vector can't distinguish Drexel's engineering from an art college's
"Communications Tech". This is world knowledge the LLM has and the data does not.

**Approach:** retrieve a broad, grounded candidate pool deterministically, then let the LLM
**select and order** the final list from that pool using its reputational knowledge. The LLM
returns dataset ids only — it re-ranks real schools, it never invents one.

**Success criteria:**
- For the co-op/hands-on CS + PA profile, the list contains the genuinely-fitting schools
  (Drexel, RIT, Penn State, WPI) that Part A alone buries.
- Every school in the list exists in the dataset with real stats — no hallucinated schools,
  enforced in code, not trusted to the model.
- Any LLM failure degrades gracefully to the Part A deterministic list (never empty, never a
  500).

## 2. Non-goals (YAGNI)

- **No free-form name proposal + fuzzy grounding.** Probing showed name-matching is brittle
  (acronyms like "RIT"/"WPI" miss or mis-match; "University of Maryland Baltimore County"
  matches "University of Baltimore"; branch-campus ambiguity). The LLM selects from a
  provided list of real ids instead, eliminating name-matching and hallucination entirely.
- **No new dataset fields, no scraping co-op data.** The reputational signal lives in the
  LLM's knowledge, applied at selection time.
- **No change to Part A scoring, the embeddings/semantic modules, de-identification, or PDF**
  beyond consuming them.
- **No enforced reach/target/safety spread on the LLM's output.** Per the chosen division of
  labor, the LLM produces the final ordered list (spread guidance is by prompt, not
  enforcement). The pool is spread-aware so the LLM has the material to build one.

## 3. Approach chosen

**Retrieve a grounded pool → LLM selects and orders → validate ids → curate → fallback.**
The engine is the retriever and safety net; the LLM is the chooser. Rejected alternatives:

- **LLM proposes names, we ground by fuzzy match** — brittle grounding (probe evidence),
  hallucination risk, disambiguation of branch campuses and acronyms.
- **LLM only re-scores relevance; engine still selects/orders** — too weak at the actual goal
  ("Drexel is the co-op school, put it in") since the engine still can't encode co-op.
- **Hybrid pool + a few write-ins** — reintroduces the name-matching edge cases for marginal
  recall gain.

## 4. Architecture

```
route (list branch):
  extract profile ─► retrievePool(profile, dataset, semantic)         [deterministic]
                        │
                        ▼
                    selectColleges({ llm, profile, pool })            [LLM: pick + order ids]
                        │  validate ids ⊆ pool; backfill to floor     [deterministic]
                        │  (LLM call error / timeout) ─────────────►  buildList(...)  [Part A fallback]
                        ▼
                    curate rationales ─► reply (present-tense summary) ─► cards
```

Preserved invariants: every returned school comes from the dataset (ids validated); all stats
are dataset-sourced; graceful degradation to deterministic. Changed: *which* schools appear is
LLM-chosen using co-op/hands-on knowledge.

## 5. Components

### `retrievePool` (in `src/lib/matching.ts`)

`retrievePool(profile, colleges, semantic): ScoredCollege[]`

- Score every college (`admitChance` + Part A `rankScore`), bucket by `admitChance`
  (existing reach/target/safety thresholds), take the top `POOL_PER_BUCKET` (≈ 20) per bucket
  by rank → an ordered pool of up to ~60 spanning selectivity.
- Recall over precision: the pool need only *contain* the good schools (Drexel/RIT/WPI), not
  rank them first.
- Geography already filters it (`rankScore` encodes `maxDistance`), so a "close" PA student's
  pool holds no California schools — the LLM cannot pick one.
- Deterministic; returns the existing `ScoredCollege` shape.
- Named const: `POOL_PER_BUCKET`.

### `selectColleges` (new `src/lib/select.ts`)

`selectColleges({ llm, profile, pool }): Promise<ScoredCollege[]>`

- **Model input:** de-identified `profile` + compact JSON of the pool, each school as
  `{ id, name, state, admitChance, satBand, netPrice, programs, tier }`. Only citable facts.
- **Output schema (Zod):** `{ picks: string[] }` — ordered ids, best-first, up to
  `listTargets.max`. Structured-output call (like the router).
- **System prompt (hardened, named const):** choose from ONLY the listed schools; return ids
  from the list, never invent a school or id; pick the ~N best for *this* student using what
  you know about each (co-op, hands-on/experiential learning, program strength, fit with the
  student's interests and constraints); order them to span reach, target, and safety. Same
  prompt-injection hardening as the router; no PII beyond the de-identified profile.
- **Validation (deterministic, in the module):** map picks to pool schools, keep only ids
  present in the pool, dedupe, preserve the model's order; if fewer than `listTargets.max`,
  backfill from the pool's deterministic order (skipping already-picked); cap at
  `listTargets.max`. Returns `ScoredCollege[]`.
- **Grounding guarantee:** the model returns ids, not schools or stats. An unknown/invented id
  is dropped. Enforced in code.
- `selectColleges` throws only if the LLM call itself errors (handled by the route's fallback);
  malformed-but-returned output is repaired by validation/backfill, never thrown.

### Route wiring (`src/app/api/chat/route.ts`, `list` branch)

- Build `pool = retrievePool(...)`. Try `selectColleges(...)` under `withResilience`; on any
  throw, fall back to `buildList(...)` (Part A). Then `curate(...)` as today.
- New progress step (named const), e.g. `"Chose the best-fit schools"`, pushed only on the LLM
  path.
- Adds one LLM call (router + select + curate = 3). Acceptable; noted.

## 6. Error handling & resilience

- **LLM call error/timeout** → Part A `buildList` fallback (never empty, HTTP 200). Reuses
  `withResilience`.
- **Model returns invalid/too-few ids** → validation drops invalids and backfills from the
  pool; never throws, never short.
- **Empty pool** (degenerate dataset) → curate/reply handle an empty list as today.
- The anti-hallucination invariant holds by construction: ids not in the pool cannot appear.

## 7. Testing

Deterministic, offline, LLM mocked (like router/curate tests).

- **`retrievePool`:** spread-aware (representation per bucket), capped at `POOL_PER_BUCKET`
  per bucket, geography-respecting (a "close" student's pool excludes far schools),
  deterministic order.
- **`selectColleges` (mock LLM):** maps ordered picks to `ScoredCollege`; **drops a
  hallucinated/unknown id**; **backfills** to `listTargets.max` when the model returns too
  few; dedupes; garbage/empty model output → a full list via backfill, never empty; system
  prompt asserts the grounding + co-op-knowledge intent.
- **Route integration (mock LLM):** the "chose the best-fit schools" step appears on success;
  **an erroring selection call still returns a non-null list** (Part A fallback, HTTP 200).
- **Grounding:** every returned id exists in the dataset — no invented school survives.
- Gate: `npm run check` green; build needs no key.

## 8. Build sequence

1. `retrievePool` in `matching.ts` (+ tests).
2. `select.ts` — `selectColleges` + validation/backfill + prompt (+ mock-LLM tests).
3. Route wiring — pool → select → fallback → curate + step (+ integration test).
4. Docs — README, `architecture.md` (the selection step + fallback), spec + plan.

## 9. Configuration & scope decisions

- **Approach B** (retrieve pool → LLM selects) over free-form proposal, for robustness and the
  anti-hallucination guarantee.
- **LLM produces the final ordered list** (spread by prompt, not enforced); the engine
  retrieves and validates.
- **`POOL_PER_BUCKET` is the recall knob** — larger pool = more candidates for the LLM, more
  tokens. Tune after use.
- **Grounding is enforced in code** (id ∈ pool), never trusted to the model.
- Builds on Part A (`rankScore`, buckets, geography, semantic); those are prerequisites.
