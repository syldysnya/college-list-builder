/**
 * Tests for the deterministic matching engine.
 *
 * Focus is correctness of the tier rules (especially the selectivity floor)
 * and the no-duplicate / flex-down list-building behavior. Uses the real
 * dataset via `loadColleges()` where a realistic distribution matters, and
 * hand-built colleges where an exact boundary is under test.
 */
import { describe, it, expect } from "vitest";
import { actToSat, classifyTier, fitScore, buildList, SELECTIVITY_FLOOR } from "./matching";
import { loadColleges } from "./dataset";
import { emptyProfile } from "./types";
import { tierTargets } from "./config";
import type { College, StudentProfile } from "./types";

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
    pctNeedMet: 0.8,
    enrollment: 10000,
    setting: "urban",
    climate: "cold",
    programStrengths: ["engineering"],
    tags: ["research"],
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

describe("classifyTier — selectivity floor", () => {
  it("floor wins over an in-range score (sub-15% school is always a reach)", () => {
    const student = profile({ sat: 1560 });
    const ultra = college({ admitRate: 0.04, satP25: 1500, satP75: 1570 });
    expect(classifyTier(student, ultra)).toBe("reach");
  });

  it("no sub-15%-admit school appears as a safety for a 1560 student", () => {
    const student = profile({ sat: 1560 });
    const list = buildList(student, loadColleges());
    for (const scored of list.safety) {
      expect(scored.college.admitRate).toBeGreaterThanOrEqual(SELECTIVITY_FLOOR);
    }
  });
});

describe("classifyTier — score bands", () => {
  it("within range and not ultra-selective ⇒ target", () => {
    const student = profile({ sat: 1300 });
    expect(classifyTier(student, college({ admitRate: 0.5, satP25: 1200, satP75: 1400 }))).toBe(
      "target"
    );
  });

  it("comfortably above range with high admit ⇒ safety", () => {
    const student = profile({ sat: 1450 });
    expect(classifyTier(student, college({ admitRate: 0.7, satP25: 1100, satP75: 1300 }))).toBe(
      "safety"
    );
  });

  it("above range but still competitive admit ⇒ target (not safety)", () => {
    const student = profile({ sat: 1450 });
    expect(classifyTier(student, college({ admitRate: 0.3, satP25: 1100, satP75: 1300 }))).toBe(
      "target"
    );
  });

  it("below range ⇒ reach", () => {
    const student = profile({ sat: 1100 });
    expect(classifyTier(student, college({ admitRate: 0.5, satP25: 1300, satP75: 1500 }))).toBe(
      "reach"
    );
  });
});

describe("classifyTier — no-score / test-optional bands", () => {
  it("no score, mid admit ⇒ target; broad admit ⇒ safety", () => {
    const student = profile({ sat: null, act: null });
    expect(classifyTier(student, college({ admitRate: 0.3, satP25: null, satP75: null }))).toBe(
      "target"
    );
    expect(classifyTier(student, college({ admitRate: 0.7, satP25: null, satP75: null }))).toBe(
      "safety"
    );
  });

  it("test-optional school falls through to admit bands even when score is known", () => {
    const student = profile({ sat: 1550 });
    expect(classifyTier(student, college({ admitRate: 0.6, satP25: null, satP75: null }))).toBe(
      "safety"
    );
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
    const strong = college({ programStrengths: ["computer science"], tags: [] });
    const weak = college({ programStrengths: ["nursing"], tags: [] });
    expect(fitScore(student, strong)).toBeGreaterThan(fitScore(student, weak));
  });
});

describe("buildList", () => {
  it("never lists a college in more than one tier or twice overall", () => {
    const student = profile({ sat: 1350, interests: ["engineering", "business"] });
    const list = buildList(student, loadColleges());
    const ids = [...list.reach, ...list.target, ...list.safety].map((s) => s.college.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("respects the per-tier cap and sorts each tier by fit desc", () => {
    const student = profile({ sat: 1300, interests: ["engineering"] });
    const list = buildList(student, loadColleges());
    for (const tier of [list.reach, list.target, list.safety]) {
      expect(tier.length).toBeLessThanOrEqual(tierTargets.perTier);
      for (let i = 1; i < tier.length; i += 1) {
        const prev = tier[i - 1];
        const cur = tier[i];
        if (prev && cur) expect(prev.fitScore).toBeGreaterThanOrEqual(cur.fitScore);
      }
    }
  });

  it("skews toward affordable schools when the student needs aid", () => {
    const dataset = loadColleges();
    // Neutral academic/interest profile so the only ranking difference is aid.
    const base = profile({ sat: 1300 });
    const avgNeedMet = (list: ReturnType<typeof buildList>): number => {
      const listed = [...list.reach, ...list.target, ...list.safety]
        .map((s) => s.college)
        .filter((c) => c.pctNeedMet != null);
      return listed.reduce((sum, c) => sum + (c.pctNeedMet ?? 0), 0) / listed.length;
    };
    const avgNetPrice = (list: ReturnType<typeof buildList>): number => {
      const listed = [...list.reach, ...list.target, ...list.safety]
        .map((s) => s.college)
        .filter((c) => c.netPrice != null);
      return listed.reduce((sum, c) => sum + (c.netPrice ?? 0), 0) / listed.length;
    };

    const aidOn = buildList(
      { ...base, constraints: { ...base.constraints, needsFinancialAid: true } },
      dataset
    );
    const aidOff = buildList(base, dataset);

    // Aid-on skews toward higher need-met and/or lower net price than aid-off.
    expect(
      avgNeedMet(aidOn) > avgNeedMet(aidOff) || avgNetPrice(aidOn) < avgNetPrice(aidOff)
    ).toBe(true);
  });

  it("populates the list and records an assumption when no test scores are given", () => {
    const student = profile({ sat: null, act: null, interests: ["biology"] });
    const list = buildList(student, loadColleges());
    expect(list.assumptions.length).toBeGreaterThan(0);
    const total = list.reach.length + list.target.length + list.safety.length;
    expect(total).toBeGreaterThan(0);
  });

  it("flexes down without padding when few colleges are supplied", () => {
    const onlyReach = college({ id: "solo", admitRate: 0.04, satP25: 1500, satP75: 1570 });
    const student = profile({ sat: 1560 });
    const list = buildList(student, [onlyReach]);
    expect(list.reach.length).toBe(1);
    expect(list.target.length).toBe(0);
    expect(list.safety.length).toBe(0);
  });

  it("uses the ACT→SAT conversion when only an ACT score is present", () => {
    const c = college({ admitRate: 0.5, satP25: 1450, satP75: 1550 });
    // ACT 34 → 1500, which sits within [1450, 1550] ⇒ target.
    const actStudent = profile({ act: 34 });
    expect(classifyTier(actStudent, c)).toBe("target");
    // A low ACT lands below the range ⇒ reach, proving the conversion drives it.
    const lowActStudent = profile({ act: 20 });
    expect(classifyTier(lowActStudent, c)).toBe("reach");
  });

  it("defaults the student name and de-dupes assumptions", () => {
    const list = buildList(profile({ name: null, sat: null, act: null }), loadColleges());
    expect(list.studentName).toBe("Student");
    expect(new Set(list.assumptions).size).toBe(list.assumptions.length);
  });
});
