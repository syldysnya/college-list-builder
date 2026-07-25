/**
 * Tests for the deterministic matching engine.
 *
 * Focus: the admit-chance model, fit scoring, and the flat ranked list-building
 * (dedupe, cap, most-likely-first ordering). Uses the real dataset via
 * `loadColleges()` where a realistic distribution matters, and hand-built
 * colleges where an exact boundary is under test.
 */
import { describe, it, expect } from "vitest";
import { actToSat, admitChance, fitScore, buildList } from "./matching";
import { loadColleges } from "./dataset";
import { emptyProfile } from "./types";
import { listTargets } from "./config";
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

describe("buildList", () => {
  it("returns a flat, deduped list capped at listTargets.max", () => {
    const student = profile({ sat: 1350, interests: ["engineering", "business"] });
    const list = buildList(student, loadColleges());
    const ids = list.colleges.map((s) => s.college.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(list.colleges.length).toBeLessThanOrEqual(listTargets.max);
    expect(list.colleges.length).toBeGreaterThan(0);
  });

  it("ranks a likely-admit school above a long-shot", () => {
    const likely = college({ id: "likely", admitRate: 0.85, satP25: 1000, satP75: 1200 });
    const longshot = college({ id: "longshot", admitRate: 0.05, satP25: 1500, satP75: 1570 });
    const student = profile({ sat: 1250 });
    const list = buildList(student, [longshot, likely]);
    expect(list.colleges[0]?.college.id).toBe("likely");
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
