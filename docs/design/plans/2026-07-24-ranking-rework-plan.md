# Ranking Rework (Selectivity Spread + Geography-Forward Fit) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the admit-chance-dominated top-N selection with a bucket-by-selectivity, fill-by-fit engine (geography-forward), and stop the chat reply from inventing its own college list.

**Architecture:** `fitScore` is rebalanced so program and geography dominate and the hidden `widenComponent` safety bias is removed. `buildList` buckets every college by the student's `admitChance` (reach/target/safety), ranks within each bucket by fit, fills quotas (3/5/4), and backfills to a full list — replacing the blended `rankScore` sort. The router prompt forbids enumerating colleges in prose.

**Tech Stack:** TypeScript (strict + `noUncheckedIndexedAccess`), Vitest. Pure, framework-free `src/lib` modules.

**Spec:** `docs/design/2026-07-24-ranking-rework-design.md`

## Global Constraints

- **Pure engine** — `matching.ts` stays free of network, LLM, randomness, and `Date`; selection is deterministic (ties broken by `prestige` then `id`).
- **No magic numbers/strings** — every weight, threshold, and quota is a named `const` referenced by name.
- **Weights sum to 100** — `fitScore` components (`W_PROGRAM + W_DISTANCE + W_PREFERENCES + W_AID`) must total 100 so the score stays 0..100.
- **Quotas sum to `listTargets.max`** — `REACH_SLOTS + TARGET_SLOTS + SAFETY_SLOTS === listTargets.max` (currently 12).
- **Preserve semantic threading** — `programComponent`'s `SemanticContext` handling and `fitScore`'s optional `semantic` param are unchanged; `buildList` still passes `semantic` through.
- **Do not change** `admitChance`, `prestige`, `programComponent` behavior, the embeddings/semantic modules, curate, route, or PDF.
- **`noUncheckedIndexedAccess`** — guard indexed access (`arr[i] ?? …`).
- **Public/portfolio repo** — no references to other codebases/companies; small conventional commits; **no `Co-Authored-By: Claude` trailer**.
- **Gate** — `npm run check` (lint + typecheck + test + build) green before a task is done.

---

### Task 1: Rebalance `fitScore` (split distance out, drop the widen bias)

**Files:**
- Modify: `src/lib/matching.ts` (weights ~76-101; `constraintComponent` ~317-341; `widenComponent` ~350-353; `fitScore` ~360-371)
- Test: `src/lib/matching.test.ts`

**Interfaces:**
- Produces: `W_PROGRAM=40`, `W_DISTANCE=30`, `W_PREFERENCES=15`, `W_AID=15`; `distanceComponent(profile, c): number`; `preferencesComponent(profile, c): number`; unchanged `fitScore(profile, c, semantic?)` signature.
- Removes: `W_CONSTRAINTS`, `W_WIDEN`, `WIDEN_ADMIT_CAP`, `constraintComponent`, `widenComponent`.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/matching.test.ts` (the `college(...)`/`profile(...)` helpers already exist):

```ts
describe("fitScore (geography-forward rebalance)", () => {
  it("weights geography heavily: same-region beats out-of-region by a wide margin", () => {
    const student = profile({ constraints: { ...emptyProfile().constraints, homeState: "PA" } });
    const inRegion = college({ id: "in", state: "NY", region: "northeast" }); // PA's region
    const outRegion = college({ id: "out", state: "CA", region: "west" });
    // New weights: W_DISTANCE(30) × (same-region 0.6 − elsewhere 0.2) = a 12-point gap.
    // Under the old weighting the gap was only ~3, so this fails before the rebalance.
    expect(fitScore(student, inRegion) - fitScore(student, outRegion)).toBeGreaterThan(10);
  });

  it("no longer rewards a higher admit rate (widen bias removed)", () => {
    const student = profile({ interests: ["engineering"] });
    const easy = college({ id: "easy", admitRate: 0.95 });
    const hard = college({ id: "hard", admitRate: 0.05 });
    // Identical on every fit input, differing only in admitRate → identical fit.
    expect(fitScore(student, easy)).toBe(fitScore(student, hard));
  });

  it("stays within 0..100 across the real dataset", () => {
    const student = profile({ interests: ["biology"], sat: 1300 });
    for (const c of loadColleges()) {
      const s = fitScore(student, c);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run src/lib/matching.test.ts -t "geography-forward"`
Expected: FAIL — the widen bias still makes `easy` score above `hard`; geography is too weak to separate the region test reliably.

- [ ] **Step 3: Replace the weights block**

In `src/lib/matching.ts`, replace the `// --- fitScore weights` block (the four `W_*` consts) with:

```ts
// --- fitScore weights (named; sum to 100) ------------------------------------
/** Program/interest overlap — the single most important signal. */
export const W_PROGRAM = 40;
/** Geography: how close the school is to the student's home (heavily weighted). */
export const W_DISTANCE = 30;
/** Climate / setting / size preference satisfaction. */
export const W_PREFERENCES = 15;
/** Affordability, only when the student needs aid (otherwise neutral). */
export const W_AID = 15;
```

Delete the `WIDEN_ADMIT_CAP` const (in the scoring-helpers block, ~line 100-101) and its comment.

- [ ] **Step 4: Split `constraintComponent` into `distanceComponent` + `preferencesComponent`, delete `widenComponent`**

Replace the whole `constraintComponent` function with these two:

```ts
/** Geography satisfaction (0..1): same-state best, same-region good, elsewhere low; neutral if no home state. */
function distanceComponent(profile: StudentProfile, c: College): number {
  const { homeState } = profile.constraints;
  if (homeState == null) return NEUTRAL;
  const home = homeState.trim().toUpperCase();
  if (home === c.state.toUpperCase()) return DISTANCE_SAME_STATE;
  if (STATE_TO_REGION[home] === c.region) return DISTANCE_SAME_REGION;
  return DISTANCE_ELSEWHERE;
}

/** Average satisfaction of the climate / setting / size preferences (0..1). */
function preferencesComponent(profile: StudentProfile, c: College): number {
  const { climate, setting, size } = profile.constraints;
  const climateScore = climate === ClimatePref.enum.none ? NEUTRAL : climate === c.climate ? 1 : 0;
  const settingScore = setting === SettingPref.enum.none ? NEUTRAL : setting === c.setting ? 1 : 0;
  const sizeScore = size === SizePref.enum.none ? NEUTRAL : size === sizeBucket(c.enrollment) ? 1 : 0;
  return (climateScore + settingScore + sizeScore) / 3;
}
```

Delete the `widenComponent` function entirely.

- [ ] **Step 5: Rewrite `fitScore` to the new weighting**

```ts
/**
 * Overall fit for a student/college pair, 0..100. Weighted sum of program,
 * distance, preferences, and aid; each component is 0..1 and the weights sum to
 * 100, so the result is bounded to [0, 100]. Selectivity is NOT part of fit — it
 * is handled by the selectivity buckets in `buildList`.
 */
export function fitScore(
  profile: StudentProfile,
  c: College,
  semantic: SemanticContext | null = null
): number {
  return (
    programComponent(profile, c, semantic) * W_PROGRAM +
    distanceComponent(profile, c) * W_DISTANCE +
    preferencesComponent(profile, c) * W_PREFERENCES +
    aidComponent(profile, c) * W_AID
  );
}
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/lib/matching.test.ts`
Expected: the three new `geography-forward` tests PASS. Pre-existing `fitScore` tests ("rewards program overlap", "rewards affordability", semantic-augmentation, 0..100) still PASS. The `buildList` "ranks a likely-admit school above a long-shot" test may now fail — that is expected and is fixed in Task 2; leave it for now.

- [ ] **Step 7: Run the gate**

Run: `npm run check`
Expected: green EXCEPT possibly the one `buildList` ordering test noted above. If only that test fails, proceed to Task 2 (it removes it). If anything else fails, fix before committing. Commit only when `matching.test.ts` is green — temporarily skip the known-obsolete test with `it.skip` and a `// removed in Task 2` note if needed to keep the commit green.

- [ ] **Step 8: Commit**

```bash
git add src/lib/matching.ts src/lib/matching.test.ts
git commit -m "feat: rebalance fitScore to be geography-forward and drop the widen bias"
```

---

### Task 2: Bucket-by-selectivity selection in `buildList`

**Files:**
- Modify: `src/lib/matching.ts` (ranking-blend consts ~41-47; `rankScore`/`byRankThenId` ~389-404; `buildList` ~413-442)
- Test: `src/lib/matching.test.ts` (the `buildList` describe block)

**Interfaces:**
- Consumes: `fitScore`, `admitChance`, `prestige` (unchanged), `listTargets.max` from `./config`.
- Produces: unchanged `buildList(profile, colleges, semantic?)` signature and `CollegeList` result; new internal `bucketOf`, `byFitThenPrestige`, `selectSpread`.
- Removes: `rankScore`, `byRankThenId`, `W_ADMIT`, `W_FIT`, `W_PRESTIGE`, `FIT_SCALE`.

- [ ] **Step 1: Write the failing tests**

In `src/lib/matching.test.ts`, DELETE the existing `it("ranks a likely-admit school above a long-shot", …)` test (its premise — admit-chance ordering — no longer holds), and add to the `buildList` describe block:

```ts
  it("guarantees a spread across reach / target / safety buckets", () => {
    // No test scores → admitChance ≈ admitRate, so buckets follow admitRate.
    const mk = (id: string, admitRate: number) => college({ id, admitRate, satP25: null, satP75: null });
    const dataset = [
      ...Array.from({ length: 5 }, (_, i) => mk(`reach-${i}`, 0.1)),   // admitChance < 0.30
      ...Array.from({ length: 6 }, (_, i) => mk(`target-${i}`, 0.5)),  // 0.30..0.75
      ...Array.from({ length: 5 }, (_, i) => mk(`safety-${i}`, 0.9)),  // ≥ 0.75
    ];
    const list = buildList(profile({ sat: null, act: null }), dataset);
    const ids = list.colleges.map((s) => s.college.id);
    // The reach quota (3) is filled — the old admit-chance sort would include ≤1 reach,
    // so this is the assertion that distinguishes the spread from the old ordering.
    expect(ids.filter((id) => id.startsWith("reach-")).length).toBeGreaterThanOrEqual(3);
    expect(ids.some((id) => id.startsWith("target-"))).toBe(true);
    expect(ids.some((id) => id.startsWith("safety-"))).toBe(true);
    // Not twelve safeties:
    expect(ids.filter((id) => id.startsWith("safety-")).length).toBeLessThan(list.colleges.length);
  });

  it("orders within a bucket by fit (program match wins)", () => {
    const student = profile({ interests: ["computer science"], sat: null, act: null });
    const match = college({ id: "match", admitRate: 0.9, programs: ["Computer Science"] });
    const noMatch = college({ id: "nomatch", admitRate: 0.9, programs: ["Agriculture"] });
    const list = buildList(student, [match, noMatch]);
    // Both are safeties; the program-matching one must be selected/ordered first.
    expect(list.colleges[0]?.college.id).toBe("match");
  });

  it("prefers a same-region school over a higher-admit out-of-region one", () => {
    const student = profile({ constraints: { ...emptyProfile().constraints, homeState: "PA" }, sat: null, act: null });
    const inRegion = college({ id: "in", state: "PA", region: "northeast", admitRate: 0.6 });
    const outRegion = college({ id: "out", state: "CA", region: "west", admitRate: 0.99 });
    const list = buildList(student, [inRegion, outRegion]);
    expect(list.colleges[0]?.college.id).toBe("in");
  });

  it("backfills to a full list when a bucket is underpopulated", () => {
    // Only safeties available, but far more than the safety quota → list still fills to max.
    const dataset = Array.from({ length: 20 }, (_, i) =>
      college({ id: `s-${i}`, admitRate: 0.95, satP25: null, satP75: null })
    );
    const list = buildList(profile({ sat: null, act: null }), dataset);
    expect(list.colleges.length).toBe(listTargets.max);
    expect(new Set(list.colleges.map((s) => s.college.id)).size).toBe(list.colleges.length);
  });
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run src/lib/matching.test.ts -t "buildList"`
Expected: FAIL — `selectSpread`/bucketing not implemented; current `byRankThenId` ordering doesn't guarantee a spread and orders by admit-chance blend.

- [ ] **Step 3: Remove the ranking-blend consts**

Delete the `// --- Ranking blend` block — the `W_ADMIT`, `W_FIT`, `W_PRESTIGE`, and `FIT_SCALE` consts (~lines 41-47). (`prestige` and its `PRESTIGE_W_*` / `SAT_STRENGTH_FLOOR` consts stay.)

- [ ] **Step 4: Add the bucket consts + helpers, replace `rankScore`/`byRankThenId`**

Add near the other selection consts:

```ts
// --- Selectivity buckets + list composition ----------------------------------
/** admitChance below this → "reach". */
const REACH_ADMIT_MAX = 0.3;
/** admitChance at/above this → "safety"; between the two → "target". */
const SAFETY_ADMIT_MIN = 0.75;
/** Guaranteed spread; these MUST sum to listTargets.max. */
const REACH_SLOTS = 3;
const TARGET_SLOTS = 5;
const SAFETY_SLOTS = 4;

type Bucket = "reach" | "target" | "safety";

function bucketOf(admitChance: number): Bucket {
  if (admitChance < REACH_ADMIT_MAX) return "reach";
  if (admitChance >= SAFETY_ADMIT_MIN) return "safety";
  return "target";
}
```

Replace the `rankScore` + `byRankThenId` functions with a fit-then-prestige comparator and the spread selector:

```ts
/** Deterministic order: highest fit first, then more-prestigious, then id. */
function byFitThenPrestige(a: ScoredCollege, b: ScoredCollege): number {
  if (b.fitScore !== a.fitScore) return b.fitScore - a.fitScore;
  const pa = prestige(a.college);
  const pb = prestige(b.college);
  if (pb !== pa) return pb - pa;
  return a.college.id < b.college.id ? -1 : a.college.id > b.college.id ? 1 : 0;
}

/**
 * Select up to `listTargets.max` colleges as a selectivity spread. Each bucket
 * (reach/target/safety) contributes up to its quota of best-fit schools; any
 * shortfall is backfilled from the best-fit unpicked schools of any bucket, so
 * the list is always as full as the data allows. The returned list is ordered
 * best-fit-first.
 */
function selectSpread(scored: ScoredCollege[]): ScoredCollege[] {
  const buckets: Record<Bucket, ScoredCollege[]> = { reach: [], target: [], safety: [] };
  for (const sc of scored) buckets[bucketOf(sc.admitChance)].push(sc);
  const quota: Record<Bucket, number> = {
    reach: REACH_SLOTS,
    target: TARGET_SLOTS,
    safety: SAFETY_SLOTS,
  };

  const picked: ScoredCollege[] = [];
  const pickedIds = new Set<string>();
  for (const key of ["reach", "target", "safety"] as Bucket[]) {
    for (const sc of [...buckets[key]].sort(byFitThenPrestige).slice(0, quota[key])) {
      picked.push(sc);
      pickedIds.add(sc.college.id);
    }
  }

  if (picked.length < listTargets.max) {
    const rest = scored.filter((sc) => !pickedIds.has(sc.college.id)).sort(byFitThenPrestige);
    for (const sc of rest) {
      if (picked.length >= listTargets.max) break;
      picked.push(sc);
    }
  }

  return picked.sort(byFitThenPrestige).slice(0, listTargets.max);
}
```

- [ ] **Step 5: Use `selectSpread` in `buildList`**

In `buildList`, replace the ranking line:

```ts
  const ranked = [...scored].sort(byRankThenId).slice(0, listTargets.max);
```

with:

```ts
  const ranked = selectSpread(scored);
```

Update the `buildList` doc comment's "ranked by a blend (chance-dominant)" wording to describe the spread selection.

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/lib/matching.test.ts`
Expected: all `buildList` tests PASS (spread, within-bucket fit, geography, backfill), plus the still-valid ones (dedupe/cap, scores every college, assumptions, student-name default). Semantic-augmentation and `fitScore` tests still PASS.

- [ ] **Step 7: Run the gate**

Run: `npm run check`
Expected: green (lint, typecheck, all tests, build). Confirm no dangling references to the removed `rankScore`/`byRankThenId`/`W_ADMIT`/`W_FIT`/`W_PRESTIGE`/`FIT_SCALE`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/matching.ts src/lib/matching.test.ts
git commit -m "feat: select colleges as a selectivity spread instead of an admit-chance sort"
```

---

### Task 3: Stop the reply from enumerating colleges (`router.ts`)

**Files:**
- Modify: `src/lib/router.ts` (the `SYSTEM` prompt array ~36-64)
- Test: `src/lib/router.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/lib/router.test.ts` (it already captures the `system` arg via the mock — see the existing "hardened system prompt" test):

```ts
  it("instructs the reply not to name or list specific colleges", async () => {
    const { llm, calls } = mockLlm({
      profile: emptyProfile(),
      action: ChatAction.enum.list,
      reply: "Here is a list.",
    });
    await route({ llm, messages: [counselorMessage("CS student in PA")], profile: emptyProfile() });
    const system = (calls[0]?.system ?? "").toLowerCase();
    expect(system).toContain("never name");
    expect(system).toContain("specific colleges");
    expect(system).toContain("cards");
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/router.test.ts -t "not to name"`
Expected: FAIL — the current prompt has no such instruction.

- [ ] **Step 3: Add the instruction to the `SYSTEM` prompt**

In `src/lib/router.ts`, inside the `SYSTEM` array, insert these lines right after the `"${ChatAction.enum.list}"` bullet block (before the closing `"reply may use light markdown…"` line):

```ts
  "",
  "The list of colleges is rendered separately to the counselor as cards; your",
  "reply must NEVER name, list, or recommend specific colleges. Do not invent or",
  "enumerate school names. Keep reply to a short framing message about the list",
  "shown below, plus (for a thin profile) the note above on what would sharpen it.",
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/lib/router.test.ts`
Expected: the new test PASSES; the existing router tests (hardened prompt, clarifying-question, prompt assembly, merged profile) still PASS.

- [ ] **Step 5: Run the gate**

Run: `npm run check`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/router.ts src/lib/router.test.ts
git commit -m "feat: stop the chat reply from enumerating its own college list"
```

---

### Task 4: Documentation

**Files:**
- Modify: `docs/architecture.md` (the matching-engine / "Key decisions at a glance" sections)

- [ ] **Step 1: Update `docs/architecture.md`**

First READ the file to match its style, then:
- In the matching-engine description, replace any wording about ranking by an admit-chance-dominant blend with the new model: **every college is scored for fit (program 40 / distance 30 / preferences 15 / aid 15) and admit chance; colleges are bucketed by admit chance into reach (<0.30) / target / safety (≥0.75); each bucket contributes its best-fit schools to a guaranteed 3/5/4 spread, backfilled to a full list and ordered best-fit-first.**
- Add a "Key decisions at a glance" row: *Selectivity spread over admit-chance sort* — the list guarantees a reach/target/safety mix instead of the twelve highest admit rates; geography is a heavily-weighted soft signal (no hard filter); the chat reply never enumerates colleges (the cards are the list).

- [ ] **Step 2: Run the gate**

Run: `npm run check`
Expected: green (docs don't affect it; confirm nothing drifted).

- [ ] **Step 3: Commit**

```bash
git add docs/architecture.md
git commit -m "docs: document the selectivity-spread ranking"
```

---

## Notes for the executor

- **`listTargets.max` is 12** and `REACH_SLOTS + TARGET_SLOTS + SAFETY_SLOTS` (3+5+4) equals it. If `listTargets.max` ever changes, the quotas must be revisited — they are the tuning surface.
- **`.codex/implementation-rules.md` is gitignored** in this repo; if you add a convention note there, edit it on disk but do NOT force-add/commit it.
- The feature is deterministic end to end; every task's tests run offline with no key.
