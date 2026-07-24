import { describe, it, expect } from "vitest";
import { renderListToBuffer } from "./pdf";
import {
  Region,
  CollegeSetting,
  CollegeClimate,
  Ownership,
  CollegeType,
  type College,
  type CollegeList,
} from "./types";

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
    enrollment: 5000,
    setting: CollegeSetting.enum.suburban,
    climate: CollegeClimate.enum.warm,
    ownership: Ownership.enum.private,
    type: CollegeType.enum.research,
    programs: ["Computer Science"],
    ...overrides,
  };
}

const sampleList: CollegeList = {
  studentName: "Jordan Rivera",
  assumptions: ["No test scores provided — admissibility estimated from admit rates."],
  colleges: [
    {
      college: makeCollege({ id: "top-1", name: "Likely State", admitRate: 0.75 }),
      fitScore: 60,
      admitChance: 0.82,
      rationale: "Broad admit rate with solid affordability.",
    },
    {
      college: makeCollege({
        id: "mid-1",
        name: "Test-Optional College",
        satP25: null,
        satP75: null,
        admitRate: 0.45,
        netPrice: null,
      }),
      fitScore: 70,
      admitChance: 0.45,
      rationale: "",
    },
    {
      college: makeCollege({ id: "reach-1", name: "Reach University", admitRate: 0.08 }),
      fitScore: 82,
      admitChance: 0.06,
      rationale: "Strong program overlap in computer science.",
    },
  ],
};

const emptyList: CollegeList = {
  studentName: "Empty Student",
  assumptions: [],
  colleges: [],
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
