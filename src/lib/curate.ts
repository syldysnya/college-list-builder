/**
 * Curation — the LLM pass that writes a short "why it fits" rationale for each
 * already-matched school. Framework-free: no imports from Next/React.
 *
 * This module is deliberately powerless over the LIST itself: the deterministic
 * matching engine (`buildList`) decides which schools appear and in which tier;
 * curation only fills the `rationale` string. Rationales are keyed by school id
 * and mapped back onto the existing tier arrays — the model can never add, drop,
 * or re-tier a school (an unknown id is ignored; a missing one yields `""`).
 */
import { z } from "zod";
import { LLMProvider } from "./llm";
import { StudentProfile, CollegeList, ScoredCollege } from "./types";

/** Empty rationale — used when the model returns none for a given school. */
const NO_RATIONALE = "";

/** Fractions (admit rate, admit chance) are surfaced to the model as whole percents. */
const PERCENT_MULTIPLIER = 100;

/**
 * Structured output: one write-up object per provided school, tagged with its id.
 * An array (not a keyed record) — dynamic-key records with object values don't
 * convert reliably to the model's structured-output schema.
 */
const CurateOutput = z.object({
  summary: z.string(),
  writeups: z.array(
    z.object({
      id: z.string(),
      whyItFits: z.string(),
      admissionsAlignment: z.string(),
    }),
  ),
});

/**
 * System prompt (named so tests can assert grounding + fairness survive). Two
 * grounded notes per school: `whyItFits` may draw on a school's well-known
 * character (co-op, hands-on), but `admissionsAlignment` must only use the
 * numbers provided. Fairness: never rationalize on protected attributes.
 */
const SYSTEM = [
  "You are a college counselor. For each school provided, write two short, warm",
  "notes a counselor can hand to the student, keyed by the school id:",
  "",
  '- "whyItFits": 2-3 sentences on why this school suits THIS student. Draw on its',
  "  programs and the student's interests and constraints, and you MAY mention the",
  "  school's well-known character (for example cooperative education / co-op,",
  "  hands-on or project-based learning, program reputation).",
  '- "admissionsAlignment": 2-3 sentences on how the student stacks up. Compare the',
  "  student's GPA, SAT/ACT, and AP scores against the school's admit rate and SAT",
  "  band, and note standout factors from their narrative or awards (for example a",
  "  competition win).",
  "",
  "Grounding: every number and statistic must come from the data provided for that",
  "school and student. Never invent or alter a figure, admit rate, ranking, or SAT",
  "band; if a number is not provided, do not state it. (Describing a school's",
  "learning character in whyItFits is fine; inventing numbers is not.)",
  "",
  "Fairness: base both notes only on academic fit, the student's interests,",
  "constraints, and the provided stats. Never rely on protected attributes (race,",
  "gender, religion, national origin, disability), even if the narrative mentions",
  "them.",
  "",
  "Also write a `summary` for the counselor: 2-3 sentences, free-form and specific",
  "to THIS student and THIS list. In natural prose, capture what the list reflects,",
  "the student's interests and situation, and the shape of the results (the range",
  "from reach to safety, and the fields or regions represented). Do NOT name or list",
  "specific colleges (they appear separately as cards), and do NOT reuse a fixed",
  "template or the same opening every time: vary it to the actual input. Only if key",
  "details are genuinely missing (for example no GPA or no test scores) may you add",
  "one brief clause that adding them would refine the list; otherwise do not.",
  "",
  "Plain text, no markup. Do not use em dashes; write with commas, colons, or",
  "periods. Return a `summary` string and a `writeups` array with one object per",
  "provided school, each with its id, a whyItFits, and an admissionsAlignment.",
].join("\n");

/** Compact, model-facing view of one matched school — only citable facts. */
function schoolPayload(sc: ScoredCollege): Record<string, unknown> {
  const { college } = sc;
  return {
    id: college.id,
    name: college.name,
    satP25: college.satP25,
    satP75: college.satP75,
    admitRatePct: Math.round(college.admitRate * PERCENT_MULTIPLIER),
    admitChancePct: Math.round(sc.admitChance * PERCENT_MULTIPLIER),
    netPrice: college.netPrice,
    ownership: college.ownership,
    type: college.type,
    programs: college.programs,
  };
}

/** Every matched school in the ranked list. */
function allSchools(list: CollegeList): ScoredCollege[] {
  return list.colleges;
}

/** Compact, model-facing view of the student — only what a rationale may cite. */
function studentPayload(profile: StudentProfile): Record<string, unknown> {
  return {
    gpa: profile.gpa,
    sat: profile.sat,
    act: profile.act,
    apScores: profile.apScores,
    interests: profile.interests,
    constraints: profile.constraints,
    narrative: profile.narrative,
  };
}

/** Render the student + the matched-schools payload into the user prompt. */
function buildPrompt(profile: StudentProfile, list: CollegeList): string {
  const schools = allSchools(list).map(schoolPayload);
  return [
    "Student (JSON):",
    JSON.stringify(studentPayload(profile)),
    "",
    "Matched schools (JSON array — write a rationale for each id, and only these):",
    JSON.stringify(schools),
    "",
    "Return a rationale for every school id above.",
  ].join("\n");
}

/**
 * Fill each school's write-up from the model's output and produce a free-form
 * `summary` of the (already-built) list, grounded in the actual results + profile.
 *
 * Invariant: the colleges are untouched — only the `rationale` /
 * `admissionsAlignment` fields change. An id the model returned that isn't in the
 * list is ignored; an id the list has but the model omitted gets `""`.
 */
export async function curate(o: {
  llm: LLMProvider;
  profile: StudentProfile;
  list: CollegeList;
}): Promise<{ list: CollegeList; summary: string }> {
  const { value } = await o.llm.generateObject({
    schema: CurateOutput,
    prompt: buildPrompt(o.profile, o.list),
    system: SYSTEM,
  });

  const byId = new Map(value.writeups.map((writeup) => [writeup.id, writeup]));
  const fill = (sc: ScoredCollege): ScoredCollege => {
    const writeup = byId.get(sc.college.id);
    return {
      ...sc,
      rationale: writeup?.whyItFits ?? NO_RATIONALE,
      admissionsAlignment: writeup?.admissionsAlignment ?? NO_RATIONALE,
    };
  };

  const list = CollegeList.parse({
    ...o.list,
    colleges: o.list.colleges.map(fill),
  });
  return { list, summary: value.summary };
}
