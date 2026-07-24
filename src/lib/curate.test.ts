import { describe, it, expect } from "vitest";
import { z } from "zod";
import { curate } from "./curate";
import { LLMProvider } from "./llm";
import {
  College,
  ScoredCollege,
  CollegeList,
  StudentProfile,
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

function scored(id: string): ScoredCollege {
  return { college: makeCollege(id), fitScore: 75, admitChance: 0.4, rationale: "" };
}

const ALL_IDS = ["c1", "c2", "c3"] as const;

/** A ranked list with three schools and no rationales yet. */
function sampleList(): CollegeList {
  return CollegeList.parse({
    studentName: "Test Student",
    assumptions: [],
    colleges: ALL_IDS.map((id) => scored(id)),
  });
}

function collectIds(list: CollegeList): string[] {
  return list.colleges.map((sc) => sc.college.id).sort();
}

function rationaleById(list: CollegeList): Record<string, string> {
  return Object.fromEntries(list.colleges.map((sc) => [sc.college.id, sc.rationale]));
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

    expect(result.colleges).toHaveLength(ALL_IDS.length);
    for (const sc of result.colleges) {
      expect(sc.rationale.length).toBeGreaterThan(0);
      expect(sc.rationale).toBe(`because ${sc.college.id} fits`);
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
    for (const sc of result.colleges) {
      expect(sc.rationale).toBe(`because ${sc.college.id}`);
    }
  });

  it("leaves missing schools with an empty rationale (no crash)", async () => {
    const { llm } = mockLlm({ c1: "only the first school" });

    const result = await curate({ llm, profile: profile(), list: sampleList() });

    const byId = rationaleById(result);
    expect(byId.c1).toBe("only the first school");
    expect(byId.c2).toBe("");
    expect(byId.c3).toBe("");
    expect(collectIds(result)).toEqual([...ALL_IDS].sort());
  });

  it("passes a system prompt covering grounding and fairness", async () => {
    const { llm, calls } = mockLlm(Object.fromEntries(ALL_IDS.map((id) => [id, "x"])));

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
