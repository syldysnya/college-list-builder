# Ranking Rework (Selectivity Spread + Geography-Forward Fit) — Design Spec

**Date:** 2026-07-24
**Status:** Approved (brainstorm)
**Context:** The generated list is dominated by ~100%-admit "safety" schools with weak program
fit and geography leakage, and the chat reply invents a parallel list that contradicts the
cards. This reworks the deterministic selection so the list is relevant, spread across
selectivity, and geography-respecting — and stops the reply from inventing its own list.

This is part **(A)** of a two-part effort. Part **(B)** — LLM candidate-generation grounded
against the dataset, for reputational signals the data lacks (co-op, "hands-on") — is a
separate later spec that assumes this ranking exists.

---

## 1. Goal

Two observed problems, on a real profile (CS-focused, hands-on/co-op, Pennsylvania):

1. **The card list is bad.** It surfaced twelve ~96–100%-admit schools — several with no
   relevant programs (an art college for a CS student) and several out of region (California,
   Wisconsin) — while the genuinely-fitting in-region CS schools that *exist in the dataset*
   (Drexel, NJIT, Penn State, RIT, Stevens) were buried.
2. **The reply contradicts the cards.** The router LLM writes a prose "best-guess list" of
   specific schools from its own knowledge, which disagrees with the deterministic cards.

**Root causes:**
- Selection is `rankScore = 0.5·admitChance + 0.3·(fit/100) + 0.2·prestige`, sorted, top 12.
  `admitChance` dominates at 0.5, so "most-admittable first, take twelve" literally means
  "the twelve safest schools." A second, smaller safety bias (`widenComponent`, weight 8)
  lives *inside* fit.
- Geography is only ¼ of `W_CONSTRAINTS=30` (~7.5 effective), too weak to exclude a
  high-admit out-of-region school.
- The router `SYSTEM` prompt tells the model to "build a list," which it satisfies by
  enumerating schools in prose.

**Success criteria:**
- The list contains a **guaranteed spread** across selectivity (reach / target / safety), not
  the twelve highest admit rates.
- For a distance-constrained student, in-region schools are strongly preferred; out-of-region
  high-admit schools no longer crowd the list.
- A zero-program-match school (art college for a CS student) does not appear over fitting ones.
- The chat reply no longer names or enumerates specific colleges.
- The engine stays deterministic, pure, and grounded; the semantic-matching threading from the
  prior feature is preserved.

## 2. Non-goals (YAGNI)

- **No LLM candidate-generation / grounding** — that is part (B).
- **No visible Reach/Target/Safety tier UI.** The output stays a single flat list; the spread
  is guaranteed by selection, not shown as grouped headers.
- **No hard filters.** Geography and program stay *soft but heavily weighted* — no dataset
  pre-filtering that could empty the list in low-density states.
- **No new dataset fields.** Reputational signals (co-op) remain out of scope (part B).
- **No change to `admitChance`, `prestige`, profile extraction, de-identification, curation,
  PDF, or the embeddings/semantic modules** beyond what selection consumes.

## 3. Approach chosen

**Bucket-by-selectivity, fill-by-fit**, with `fitScore` rebalanced to be geography- and
program-forward and the `admitChance`-dominated blend removed. Rejected alternatives:

- **Sort purely by fit, ignore selectivity** — no guaranteed spread; could yield an all-reach
  or all-safety list depending on the profile.
- **Keep the blended `rankScore`, just retune weights** — retuning can reduce but not
  structurally guarantee a spread, and the top-N cut still clusters at one selectivity band.
- **Hard geography/program filters** — brittle (empty lists for rural students; a student with
  an unusual interest loses everything). Rejected in favor of heavy soft weights.

## 4. Architecture

Selection changes from a single blended sort to a bucket-and-fill:

```
for each college: admitChance (unchanged) + fitScore (rebalanced §5)
        │
        ▼
bucket by admitChance:  reach (<0.30) | target (0.30–0.75) | safety (≥0.75)
        │
        ▼   within each bucket, rank by fitScore desc, tiebreak prestige, then id
fill quotas: 3 reach / 5 target / 4 safety   (= listTargets.max = 12)
        │
        ▼   backfill any shortfall from a global fit-ranked pool of unpicked schools
assembled 12  ──►  final display order: fitScore desc (tiebreak prestige, id)
```

`admitChance` selects the *bucket* but is removed from within-bucket ordering, so selectivity
is represented by the quota rather than dominating the ranking. The list is always full at
`listTargets.max`; the spread is as complete as the data supports.

## 5. Data model / scoring changes (`matching.ts`)

### fitScore rebalance

Remove `widenComponent` (and `W_WIDEN`, `WIDEN_ADMIT_CAP`) — its only effect is to reward
high admit rates, which the bucketing now handles correctly. Promote distance from a quarter
of the constraint average to a standalone, heavily-weighted term.

| Component | Old weight | New weight | Notes |
|---|---|---|---|
| `W_PROGRAM` | 50 | **40** | dominant fit signal (program match, keyword + semantic) |
| `W_DISTANCE` (new standalone) | ~7.5 effective | **30** | geography ~4× stronger |
| `W_PREFERENCES` (climate/setting/size avg) | ~22.5 effective | **15** | soft preferences |
| `W_AID` | 12 | **15** | affordability |
| `W_WIDEN` | 8 | **removed** | bucketing replaces it |

New weights sum to 100, so `fitScore` stays 0..100.

- `distanceComponent` keeps its current mapping and constants: same-state `1.0`, same-region
  `0.6`, elsewhere `0.2`, and `NEUTRAL` (`0.5`) when `homeState` is null. It becomes its own
  `fitScore` term at weight `W_DISTANCE`.
- `preferencesComponent` = the average of the existing climate / setting / size sub-scores
  (the old `constraintComponent` minus distance), at weight `W_PREFERENCES`.
- `programComponent` and `aidComponent` are unchanged in behavior; only their weights move.
- Semantic threading (`SemanticContext` through `programComponent`) is unchanged.

### Selection / buckets

New named consts:

```
REACH_ADMIT_MAX = 0.30      // admitChance < 0.30 → reach
SAFETY_ADMIT_MIN = 0.75     // admitChance ≥ 0.75 → safety; between → target
REACH_SLOTS = 3
TARGET_SLOTS = 5
SAFETY_SLOTS = 4            // sums to listTargets.max = 12
```

- `bucketOf(admitChance)` → `"reach" | "target" | "safety"`.
- Within a bucket: sort by `fitScore` desc, tiebreak `prestige(c)` desc, then `id` asc (fully
  deterministic).
- Fill each bucket up to its quota; collect any shortfall; backfill remaining slots from a
  single fit-ranked pool of not-yet-selected colleges (any bucket), same tiebreaks.
- Final list order: `fitScore` desc, tiebreak `prestige` desc, then `id` asc.

### Removed

`rankScore`, `byRankThenId`, and the blend weights `W_ADMIT` / `W_FIT` / `W_PRESTIGE` /
`FIT_SCALE` are removed — selection no longer uses a single blended score. `prestige()` stays
(now the within-bucket / final tiebreak). `admitChance()` is unchanged.

## 6. Reply fix (`router.ts`)

The `SYSTEM` prompt gains an explicit instruction: the `reply` is a **brief framing message
and must never name or enumerate specific colleges** — the list is rendered separately as
cards. For a thin profile it still opens by noting the list is a best-effort, rough guess and
lists what would sharpen it (GPA, test scores, intended major/interests, budget or aid need,
home state and travel distance, campus size), *without* naming schools. The no-clarifying-
question and prompt-injection-hardening behavior is unchanged.

## 7. Error handling / edge cases

- **Sparse buckets** — fewer qualifying schools than a quota: backfill from the global
  fit-ranked pool guarantees a full list; if the whole dataset is smaller than
  `listTargets.max`, return all of it (no crash, no duplicates).
- **No `homeState`** — `distanceComponent` returns `NEUTRAL`, so distance neither helps nor
  hurts; ranking falls back to program/preferences/aid. No geography penalty is applied to
  anyone.
- **No test scores** — `admitChance` falls back to `admitRate` (unchanged), so bucketing still
  works off admit rate.
- **Ties** — fully broken by `prestige` then `id`, so ordering is deterministic.

## 8. Testing

All deterministic, offline.

- **Guaranteed spread** — a dataset spanning admit rates yields a list with representation from
  each bucket per quota (not twelve safeties).
- **Within-bucket by fit** — of two same-bucket schools, the higher-`fitScore` one is selected
  / ordered first.
- **Geography weight** — for a `homeState`-set student, a same-region school is selected over a
  higher-admit out-of-region school.
- **Program weight** — a program-matching school is selected over a zero-program-match school
  for the same interest.
- **Backfill** — a dataset with too few reach schools still returns a full list, no crash, no
  duplicate ids.
- **fitScore bounds** — stays within 0..100 and no longer references `admitRate` (widen gone).
- **Semantic still threads** — passing a `SemanticContext` still augments program fit (the
  prior feature's guarantee holds through the rebalance).
- **Router** — the `SYSTEM` prompt instructs *not* to enumerate colleges; security /
  no-clarifying-question assertions unchanged.
- Existing `buildList` ordering assertions are updated to the new selection order.

**Gate:** `npm run check` (lint + typecheck + test + build) green.

## 9. Build sequence

1. `fitScore` rebalance: split distance out, add `preferencesComponent`, remove `widenComponent`,
   new weights (+ tests for fit bounds / geography / program weighting).
2. Bucketing + selection rewrite in `buildList`: buckets, quotas, backfill, final sort; remove
   `rankScore`/`byRankThenId`/blend weights (+ spread / backfill tests).
3. Router reply-prompt fix (+ router test).
4. Docs — `architecture.md` ranking section; spec + plan.

## 10. Configuration & scope decisions

- **Single flat list, guaranteed spread** — no tier UI (kept per the current design).
- **Soft, heavily-weighted geography** (not a hard filter) — robust for low-density states.
- **Bucket thresholds and quotas are named consts** — the tuning surface if the spread needs
  adjusting after real use.
- **Part (A) only** — LLM candidate-generation + grounding is deferred to part (B).
