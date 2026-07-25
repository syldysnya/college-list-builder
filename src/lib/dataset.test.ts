/**
 * Tests for the college dataset loader.
 *
 * `src/data/colleges.json` is synced from the U.S. DOE College Scorecard API
 * (see `scripts/sync-scorecard.ts`) — ~1,500 four-year US colleges with real
 * admit rates, SAT bands, net price, and degree-share programs.
 */
import { describe, it, expect } from "vitest";
import { loadColleges } from "./dataset";
import { REGIONS } from "./types";

const MIN_RECORDS = 30;
const ULTRA_SELECTIVE_ADMIT_RATE = 0.15;
const HIGH_ADMIT_RATE = 0.5;

describe("loadColleges", () => {
  it("parses without throwing and returns at least the minimum record count", () => {
    expect(() => loadColleges()).not.toThrow();
    expect(loadColleges().length).toBeGreaterThanOrEqual(MIN_RECORDS);
  });

  it("includes at least one college in every region", () => {
    const colleges = loadColleges();
    for (const region of REGIONS) {
      expect(colleges.some((college) => college.region === region)).toBe(true);
    }
  });

  it("includes both an ultra-selective and a high-admit school (selectivity spread)", () => {
    const colleges = loadColleges();
    expect(colleges.some((college) => college.admitRate < ULTRA_SELECTIVE_ADMIT_RATE)).toBe(true);
    expect(colleges.some((college) => college.admitRate > HIGH_ADMIT_RATE)).toBe(true);
  });

  it("keeps every admitRate within 0..1", () => {
    const colleges = loadColleges();
    for (const college of colleges) {
      expect(college.admitRate).toBeGreaterThanOrEqual(0);
      expect(college.admitRate).toBeLessThanOrEqual(1);
    }
  });

  it("includes at least one test-optional / missing-SAT-data school", () => {
    const colleges = loadColleges();
    expect(colleges.some((college) => college.satP25 === null)).toBe(true);
  });

  it("caches the parsed array across calls", () => {
    expect(loadColleges()).toBe(loadColleges());
  });
});
