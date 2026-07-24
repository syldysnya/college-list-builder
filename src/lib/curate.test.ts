import { describe, it, expect } from "vitest";
import { z } from "zod";
import { curate } from "./curate";
import { LLMProvider } from "./llm";
import {
  College,
  ScoredCollege,
  CollegeList,
  StudentProfile,
  Tier,
  TIERS,
  Region,
  CollegeSetting,
  CollegeClimate,
  emptyProfile,
} from "./types";
import { Usage } from "./pricing";

/** Args captured from the single `generateObject` call curate makes. */
interface CapturedCall {
  schema: z.ZodType<unknown>;
  prompt: string;
  system?: string;
}

type Rationales = Record<string, string>;

/**
 * Mock LLMProvider: `generateObject` returns canned rationales (ignoring the
 * schema — no real model) and records its args. text/stream are unused here.
 */
function mockLlm(rationales: Rationales): { llm: LLMProvider; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const llm: LLMProvider = {
    async generateObject<T>(o: { schema: z.ZodType<T>; prompt: string; system?: string }) {
      calls.push({ schema: o.schema, prompt: o.prompt, system: o.system });
      return { value: { rationales } as T, usage };
    },
    generateText() {
      throw new Error("generateText not used by curate");
    },
    streamText() {
      throw new Error("streamText not used by curate");
    },
  };
  return { llm, calls };
}

function makeCollege(id: string): College {
  return {
    id,
    name: `College ${id}`,
    city: "Townsville",
    state: "CA",
    region: Region.enum.west,
    satP25: 1200,
    satP75: 1400,
    admitRate: 0.3,
    netPrice: 20000,
    pctNeedMet: 0.9,
    enrollment: 8000,
    setting: CollegeSetting.enum.urban,
    climate: CollegeClimate.enum.warm,
    programStrengths: ["computer science"],
    tags: ["research"],
  };
}

function scored(id: string, tier: Tier): ScoredCollege {
  return { college: makeCollege(id), fitScore: 75, tier, rationale: "" };
}

/** A list with one school per tier (reach=r1, target=t1, safety=s1). */
function sampleList(): CollegeList {
  return CollegeList.parse({
    studentName: "Test Student",
    assumptions: [],
    reach: [scored("r1", Tier.enum.reach)],
    target: [scored("t1", Tier.enum.target)],
    safety: [scored("s1", Tier.enum.safety)],
  });
}

const ALL_IDS = ["r1", "t1", "s1"] as const;

function collectIds(list: CollegeList): string[] {
  return TIERS.flatMap((tier) => list[tier].map((sc) => sc.college.id)).sort();
}

function profile(): StudentProfile {
  return { ...emptyProfile(), name: "Test Student", interests: ["computer science"] };
}

describe("curate", () => {
  it("fills every school's rationale and leaves the id set unchanged", async () => {
    const rationales: Rationales = Object.fromEntries(
      ALL_IDS.map((id) => [id, `because ${id} fits`])
    );
    const { llm } = mockLlm(rationales);

    const result = await curate({ llm, profile: profile(), list: sampleList() });

    for (const tier of TIERS) {
      expect(result[tier]).toHaveLength(1);
      for (const sc of result[tier]) {
        expect(sc.rationale.length).toBeGreaterThan(0);
        expect(sc.rationale).toBe(`because ${sc.college.id} fits`);
      }
    }
    expect(collectIds(result)).toEqual([...ALL_IDS].sort());
  });

  it("ignores a returned id that is not in the list (adds no school)", async () => {
    const rationales: Rationales = {
      ...Object.fromEntries(ALL_IDS.map((id) => [id, `because ${id}`])),
      ghost: "because a school that does not exist",
    };
    const { llm } = mockLlm(rationales);

    const result = await curate({ llm, profile: profile(), list: sampleList() });

    expect(collectIds(result)).toEqual([...ALL_IDS].sort());
    for (const tier of TIERS) {
      for (const sc of result[tier]) {
        expect(sc.rationale).toBe(`because ${sc.college.id}`);
      }
    }
  });

  it("leaves missing schools with an empty rationale (no crash)", async () => {
    const { llm } = mockLlm({ r1: "only the reach school" });

    const result = await curate({ llm, profile: profile(), list: sampleList() });

    expect(result.reach[0]?.rationale).toBe("only the reach school");
    expect(result.target[0]?.rationale).toBe("");
    expect(result.safety[0]?.rationale).toBe("");
    expect(collectIds(result)).toEqual([...ALL_IDS].sort());
  });

  it("passes a system prompt covering grounding and fairness", async () => {
    const { llm, calls } = mockLlm(
      Object.fromEntries(ALL_IDS.map((id) => [id, "x"]))
    );

    await curate({ llm, profile: profile(), list: sampleList() });

    expect(calls).toHaveLength(1);
    const system = (calls[0]?.system ?? "").toLowerCase();
    expect(system.length).toBeGreaterThan(0);
    // Grounding: only the provided facts.
    expect(system).toContain("grounding");
    expect(system).toContain("never invent");
    // Fairness: ignore protected attributes.
    expect(system).toContain("fairness");
    expect(system).toContain("protected attributes");
  });
});
