import { describe, it, expect } from "vitest";
import {
  College,
  CollegeClimate,
  CollegeSetting,
  CollegeType,
  Ownership,
  Region,
  StudentProfile,
  emptyProfile,
} from "./types";

describe("emptyProfile", () => {
  it("produces a value StudentProfile.parse accepts", () => {
    expect(() => StudentProfile.parse(emptyProfile())).not.toThrow();
  });

  it("defaults needsFinancialAid to false", () => {
    expect(emptyProfile().constraints.needsFinancialAid).toBe(false);
  });

  it("defaults practicalHandsOn to false and narrative to an empty string", () => {
    const profile = emptyProfile();
    expect(profile.constraints.practicalHandsOn).toBe(false);
    expect(profile.narrative).toBe("");
  });
});

describe("StudentProfile", () => {
  it("rejects an out-of-range SAT score", () => {
    const profile = { ...emptyProfile(), sat: 2000 };
    expect(StudentProfile.safeParse(profile).success).toBe(false);
  });

  it("rejects an out-of-range AP score", () => {
    const profile = {
      ...emptyProfile(),
      apScores: [{ subject: "Calculus BC", score: 6 }],
    };
    expect(StudentProfile.safeParse(profile).success).toBe(false);
  });

  it("accepts a fully populated valid profile", () => {
    const profile: StudentProfile = {
      ...emptyProfile(),
      name: "Jamie Rivera",
      gpa: 3.8,
      sat: 1420,
      act: 32,
      apScores: [{ subject: "Physics C", score: 5 }],
      interests: ["robotics", "music"],
      narrative: "Strong STEM student interested in engineering.",
    };
    expect(StudentProfile.safeParse(profile).success).toBe(true);
  });
});

describe("College", () => {
  const minimalCollege = {
    id: "college-1",
    name: "Example University",
    city: "Springfield",
    state: "IL",
    region: Region.enum.midwest,
    satP25: null,
    satP75: null,
    admitRate: 0.5,
    netPrice: null,
    enrollment: 12000,
    setting: CollegeSetting.enum.urban,
    climate: CollegeClimate.enum.cold,
    ownership: Ownership.enum.public,
    type: CollegeType.enum.other,
    programs: [],
  };

  it("parses a minimal valid record", () => {
    expect(College.safeParse(minimalCollege).success).toBe(true);
  });

  it("accepts boundary admitRate values (including 0 and 1)", () => {
    const atBoundaries = { ...minimalCollege, admitRate: 0 };
    expect(College.safeParse(atBoundaries).success).toBe(true);
    expect(College.safeParse({ ...minimalCollege, admitRate: 1 }).success).toBe(true);
  });

  it("rejects a record missing required fields", () => {
    const withoutId: Partial<typeof minimalCollege> = { ...minimalCollege };
    delete withoutId.id;
    expect(College.safeParse(withoutId).success).toBe(false);
  });
});
