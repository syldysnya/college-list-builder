import { describe, it, expect } from "vitest";
import { renderListToBuffer } from "./pdf";
import { Tier, Region, CollegeSetting, CollegeClimate, type College, type CollegeList } from "./types";

const PDF_MAGIC = "%PDF";

function makeCollege(overrides: Partial<College>): College {
  return {
    id: "base",
    name: "Base University",
    city: "Springfield",
    state: "IL",
    region: Region.enum.midwest,
    satP25: 1200,
    satP75: 1400,
    admitRate: 0.3,
    netPrice: 25000,
    pctNeedMet: 0.8,
    enrollment: 5000,
    setting: CollegeSetting.enum.suburban,
    climate: CollegeClimate.enum.warm,
    programStrengths: ["Computer Science"],
    tags: [],
    ...overrides,
  };
}

const sampleList: CollegeList = {
  studentName: "Jordan Rivera",
  assumptions: ["No test scores provided — admissibility estimated from admit rates."],
  reach: [
    {
      college: makeCollege({ id: "reach-1", name: "Reach University", admitRate: 0.08 }),
      fitScore: 82,
      tier: Tier.enum.reach,
      rationale: "Strong program overlap in computer science.",
    },
  ],
  target: [
    {
      college: makeCollege({
        id: "target-1",
        name: "Target College",
        satP25: null,
        satP75: null,
        admitRate: 0.45,
        netPrice: null,
      }),
      fitScore: 70,
      tier: Tier.enum.target,
      rationale: "",
    },
  ],
  safety: [
    {
      college: makeCollege({ id: "safety-1", name: "Safety State", admitRate: 0.75 }),
      fitScore: 60,
      tier: Tier.enum.safety,
      rationale: "Broad admit rate with solid affordability.",
    },
  ],
};

const emptyList: CollegeList = {
  studentName: "Empty Student",
  assumptions: [],
  reach: [],
  target: [],
  safety: [],
};

describe("renderListToBuffer", () => {
  it("renders a populated list to a valid PDF buffer", async () => {
    const buf = await renderListToBuffer(sampleList, new Date(0));
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 4).toString()).toBe(PDF_MAGIC);
  });

  it("renders an empty list (no schools, no assumptions) without crashing", async () => {
    const buf = await renderListToBuffer(emptyList, new Date(0));
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 4).toString()).toBe(PDF_MAGIC);
  });
});
