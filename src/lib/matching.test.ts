/**
 * Tests for the deterministic matching engine.
 *
 * Focus: the admit-chance model, fit scoring, and list-building (dedupe, cap,
 * selectivity-spread selection, best-fit-first ordering). Uses the real dataset
 * via `loadColleges()` where a realistic distribution matters, and hand-built
 * colleges where an exact boundary is under test.
 */
import { describe, it, expect } from "vitest";
import {
  actToSat,
  admitChance,
  fitScore,
  buildList,
  retrievePool,
  POOL_PER_BUCKET,
  selectivityTier,
} from "./matching";
import { loadColleges } from "./dataset";
import { emptyProfile } from "./types";
import { listTargets } from "./config";
import type { College, StudentProfile } from "./types";
import type { SemanticContext } from "./matching";

function profile(overrides: Partial<StudentProfile> = {}): StudentProfile {
  return { ...emptyProfile(), ...overrides };
}

function college(overrides: Partial<College> = {}): College {
  return {
    id: "test-u",
    name: "Test University",
    city: "Testville",
    state: "MA",
    region: "northeast",
    satP25: 1200,
    satP75: 1400,
    admitRate: 0.5,
    netPrice: 20000,
    enrollment: 10000,
    setting: "urban",
    climate: "cold",
    ownership: "private",
    type: "research",
    programs: ["Engineering"],
    ...overrides,
  };
}

describe("actToSat", () => {
  it("returns table anchors exactly and clamps to the SAT range", () => {
    expect(actToSat(34)).toBe(1500);
    expect(actToSat(36)).toBe(1590);
    expect(actToSat(20)).toBe(1040);
    expect(actToSat(1)).toBeGreaterThanOrEqual(400);
    expect(actToSat(1)).toBeLessThanOrEqual(1600);
  });

  it("interpolates between anchors", () => {
    const mid = actToSat(30.5);
    expect(mid).toBeGreaterThan(actToSat(30));
    expect(mid).toBeLessThan(actToSat(31));
  });
});

describe("admitChance", () => {
  it("stays within (0, 1] across the real dataset", () => {
    for (const c of loadColleges()) {
      const chance = admitChance(profile({ sat: 1300 }), c);
      expect(chance).toBeGreaterThan(0);
      expect(chance).toBeLessThanOrEqual(1);
    }
  });

  it("is higher above the school's band than below it", () => {
    const c = college({ admitRate: 0.5, satP25: 1200, satP75: 1400 });
    const above = admitChance(profile({ sat: 1500 }), c);
    const below = admitChance(profile({ sat: 1100 }), c);
    expect(above).toBeGreaterThan(below);
  });

  it("uses the admit rate as-is when no usable score is available", () => {
    const c = college({ admitRate: 0.42, satP25: 1200, satP75: 1400 });
    expect(admitChance(profile({ sat: null, act: null }), c)).toBeCloseTo(0.42, 5);
  });

  it("uses the ACT→SAT conversion when only an ACT score is present", () => {
    const c = college({ admitRate: 0.5, satP25: 1450, satP75: 1550 });
    const act34 = admitChance(profile({ act: 34 }), c); // 1500 — within band
    const act20 = admitChance(profile({ act: 20 }), c); // 1040 — below band
    expect(act34).toBeGreaterThan(act20);
  });
});

describe("fitScore", () => {
  it("stays within 0..100", () => {
    const student = profile({ interests: ["engineering"], sat: 1300 });
    for (const c of loadColleges()) {
      const s = fitScore(student, c);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });

  it("rewards program overlap", () => {
    const student = profile({ interests: ["computer science"] });
    const strong = college({ programs: ["Computer Science"] });
    const weak = college({ programs: ["Health & Nursing"] });
    expect(fitScore(student, strong)).toBeGreaterThan(fitScore(student, weak));
  });

  it("rewards affordability when the student needs aid", () => {
    const student = profile({
      constraints: { ...emptyProfile().constraints, needsFinancialAid: true },
    });
    const cheap = college({ netPrice: 5000 });
    const pricey = college({ netPrice: 39000 });
    expect(fitScore(student, cheap)).toBeGreaterThan(fitScore(student, pricey));
  });
});

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

describe("fitScore (geography-forward rebalance)", () => {
  it("orders geography by tier: same-state > adjacent > same-region > elsewhere", () => {
    const student = profile({ constraints: { ...emptyProfile().constraints, homeState: "PA" } });
    const sameState = college({ id: "pa", state: "PA", region: "northeast" });
    const adjacent = college({ id: "nj", state: "NJ", region: "northeast" }); // borders PA
    const sameRegion = college({ id: "ma", state: "MA", region: "northeast" }); // region, not adjacent
    const elsewhere = college({ id: "ca", state: "CA", region: "west" });
    const f = (c: College) => fitScore(student, c);
    expect(f(sameState)).toBeGreaterThan(f(adjacent));
    expect(f(adjacent)).toBeGreaterThan(f(sameRegion));
    expect(f(sameRegion)).toBeGreaterThan(f(elsewhere));
    // Adjacent (a truly close school) beats elsewhere by a wide margin.
    expect(f(adjacent) - f(elsewhere)).toBeGreaterThan(15);
  });

  it("turns geography off when the student says distance does not matter", () => {
    const anywhere = profile({
      constraints: { ...emptyProfile().constraints, homeState: "PA", maxDistance: "anywhere" },
    });
    const home = college({ id: "pa", state: "PA", region: "northeast" });
    const far = college({ id: "ca", state: "CA", region: "west" });
    expect(fitScore(anywhere, home)).toBe(fitScore(anywhere, far));
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

describe("buildList", () => {
  it("returns a flat, deduped list capped at listTargets.max", () => {
    const student = profile({ sat: 1350, interests: ["engineering", "business"] });
    const list = buildList(student, loadColleges());
    const ids = list.colleges.map((s) => s.college.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(list.colleges.length).toBeLessThanOrEqual(listTargets.max);
    expect(list.colleges.length).toBeGreaterThan(0);
  });

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

  it("lets prestige surface the stronger school over a marginally-better-fit one", () => {
    // Same selectivity bucket. `pref` fits the setting preference slightly better,
    // but `elite` is far more prestigious (higher SAT). With prestige weighted into
    // ranking the elite school leads; under a fit-only sort it would not.
    const student = profile({
      sat: null,
      act: null,
      constraints: { ...emptyProfile().constraints, setting: "urban" },
    });
    const elite = college({ id: "elite", admitRate: 0.9, setting: "rural", satP25: 1450, satP75: 1550 });
    const pref = college({ id: "pref", admitRate: 0.9, setting: "urban", satP25: 1000, satP75: 1100 });
    const list = buildList(student, [pref, elite]);
    expect(list.colleges[0]?.college.id).toBe("elite");
  });

  it("gates geography and prestige by program relevance (no off-field schools for a focused student)", () => {
    const student = profile({
      interests: ["computer science"],
      sat: null,
      act: null,
      constraints: { ...emptyProfile().constraints, homeState: "PA" },
    });
    // `art` is same-state AND more prestigious (higher SAT), but off-field for a CS
    // student, so its geography/prestige lift is gated away and the CS school leads.
    const cs = college({ id: "cs", state: "PA", admitRate: 0.9, programs: ["Computer Science"], satP25: 1000, satP75: 1150 });
    const art = college({ id: "art", state: "PA", admitRate: 0.9, programs: ["Visual & Performing Arts"], satP25: 1400, satP75: 1550 });
    const list = buildList(student, [art, cs]);
    expect(list.colleges[0]?.college.id).toBe("cs");
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

  it("scores every listed college for fit and admit chance", () => {
    const list = buildList(profile({ sat: 1300 }), loadColleges());
    for (const s of list.colleges) {
      expect(s.fitScore).toBeGreaterThanOrEqual(0);
      expect(s.fitScore).toBeLessThanOrEqual(100);
      expect(s.admitChance).toBeGreaterThan(0);
      expect(s.admitChance).toBeLessThanOrEqual(1);
    }
  });

  it("records an assumption and still returns colleges when no test scores are given", () => {
    const student = profile({ sat: null, act: null, interests: ["biology"] });
    const list = buildList(student, loadColleges());
    expect(list.assumptions.length).toBeGreaterThan(0);
    expect(list.colleges.length).toBeGreaterThan(0);
  });

  it("defaults the student name and de-dupes assumptions", () => {
    const list = buildList(profile({ name: null, sat: null, act: null }), loadColleges());
    expect(list.studentName).toBe("Student");
    expect(new Set(list.assumptions).size).toBe(list.assumptions.length);
  });
});

describe("retrievePool", () => {
  it("includes schools from every selectivity tier, capped per tier", () => {
    // POOL_PER_BUCKET is 20; give each tier more than that so the cap bites.
    const mk = (id: string, admitRate: number) => college({ id, admitRate, satP25: null, satP75: null });
    const dataset = [
      ...Array.from({ length: 25 }, (_, i) => mk(`reach-${i}`, 0.1)),
      ...Array.from({ length: 25 }, (_, i) => mk(`target-${i}`, 0.5)),
      ...Array.from({ length: 25 }, (_, i) => mk(`safety-${i}`, 0.9)),
    ];
    const pool = retrievePool(profile({ sat: null, act: null }), dataset);
    const count = (p: string) => pool.filter((sc) => sc.college.id.startsWith(p)).length;
    expect(count("reach-")).toBe(POOL_PER_BUCKET);
    expect(count("target-")).toBe(POOL_PER_BUCKET);
    expect(count("safety-")).toBe(POOL_PER_BUCKET);
  });

  it("keeps nearby schools and drops far ones when a tier overflows", () => {
    // 25 PA safeties (nearby) + 1 CA safety (far). Cap is 20 → the far one is out.
    const student = profile({ constraints: { ...emptyProfile().constraints, homeState: "PA" }, sat: null, act: null });
    const dataset = [
      ...Array.from({ length: 25 }, (_, i) => college({ id: `pa-${i}`, state: "PA", region: "northeast", admitRate: 0.9, satP25: null, satP75: null })),
      college({ id: "ca", state: "CA", region: "west", admitRate: 0.9, satP25: null, satP75: null }),
    ];
    const pool = retrievePool(student, dataset);
    expect(pool.some((sc) => sc.college.id === "ca")).toBe(false);
  });

  it("is deterministic", () => {
    const student = profile({ sat: 1200 });
    const a = retrievePool(student, loadColleges()).map((sc) => sc.college.id);
    const b = retrievePool(student, loadColleges()).map((sc) => sc.college.id);
    expect(a).toEqual(b);
  });
});

describe("selectivityTier", () => {
  it("labels reach / target / safety by admit chance", () => {
    expect(selectivityTier(0.1)).toBe("reach");
    expect(selectivityTier(0.5)).toBe("target");
    expect(selectivityTier(0.9)).toBe("safety");
  });
});
