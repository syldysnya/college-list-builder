import { describe, it, expect } from "vitest";
import { z } from "zod";
import { finalizeSelection, selectColleges } from "./select";
import { LLMProvider } from "./llm";
import { College, ScoredCollege, Region, CollegeSetting, CollegeClimate, Ownership, CollegeType, emptyProfile } from "./types";
import { Usage } from "./pricing";

function makeCollege(id: string): College {
  return {
    id, name: `College ${id}`, city: "Townsville", state: "PA", region: Region.enum.northeast,
    satP25: 1100, satP75: 1300, admitRate: 0.5, netPrice: 20000, enrollment: 8000,
    setting: CollegeSetting.enum.urban, climate: CollegeClimate.enum.cold,
    ownership: Ownership.enum.private, type: CollegeType.enum.research, programs: ["Computer Science"],
  };
}
function scored(id: string): ScoredCollege {
  return { college: makeCollege(id), fitScore: 70, admitChance: 0.5, rationale: "" };
}
const pool = ["a", "b", "c", "d"].map(scored);

/** Mock LLM whose generateObject returns canned picks and records the system prompt. */
function mockLlm(picks: string[]): { llm: LLMProvider; systems: string[] } {
  const systems: string[] = [];
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const llm: LLMProvider = {
    async generateObject<T>(o: { schema: z.ZodType<T>; prompt: string; system?: string }) {
      systems.push(o.system ?? "");
      return { value: { picks } as T, usage };
    },
    generateText() { throw new Error("unused"); },
    streamText() { throw new Error("unused"); },
  };
  return { llm, systems };
}

describe("finalizeSelection", () => {
  it("keeps only valid pool ids, in the model's order", () => {
    const result = finalizeSelection(["c", "a"], pool).map((sc) => sc.college.id);
    expect(result).toEqual(["c", "a", "b", "d"]); // c,a chosen first; rest backfilled in pool order
  });
  it("drops ids that are not in the pool (no hallucinated school survives)", () => {
    const result = finalizeSelection(["ghost", "b"], pool).map((sc) => sc.college.id);
    expect(result).not.toContain("ghost");
    expect(result[0]).toBe("b");
  });
  it("dedupes repeated ids", () => {
    const result = finalizeSelection(["a", "a", "b"], pool).map((sc) => sc.college.id);
    expect(result.filter((id) => id === "a")).toHaveLength(1);
  });
  it("backfills from the pool when the model returns nothing", () => {
    const result = finalizeSelection([], pool).map((sc) => sc.college.id);
    expect(result).toEqual(["a", "b", "c", "d"]); // pool order, full
  });
});

describe("selectColleges", () => {
  it("returns the finalized picks and passes a grounded, co-op-aware system prompt", async () => {
    const { llm, systems } = mockLlm(["b", "d"]);
    const result = await selectColleges({ llm, profile: emptyProfile(), pool });
    expect(result.slice(0, 2).map((sc) => sc.college.id)).toEqual(["b", "d"]);
    const system = (systems[0] ?? "").toLowerCase();
    expect(system).toContain("only");        // choose from ONLY the listed schools
    expect(system).toContain("never invent"); // never invent a school or id
    expect(system).toContain("co-op");         // reputational knowledge cue
  });
});
