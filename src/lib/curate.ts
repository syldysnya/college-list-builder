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

/** Structured output: one rationale string per provided school id. */
const CurateOutput = z.object({
  rationales: z.record(z.string(), z.string()),
});

/**
 * System prompt (named so tests can assert grounding + fairness survive).
 * Grounding: cite only the facts provided per school and the student's stated
 * interests/constraints. Fairness: never rationalize on protected attributes.
 */
const SYSTEM = [
  "You are a college counselor. For each school provided, write a short, warm",
  '"why this fits <the student>" note that a counselor can hand to the student.',
  "",
  "Grounding: cite ONLY the facts given for that school (its stats,",
  "programStrengths, tags) and the student's stated interests and constraints.",
  "Never invent facts, rankings, reputations, or any claim that is not provided.",
  "",
  "Fairness: base every rationale only on academic fit, the student's interests,",
  "and their stated constraints. Never rely on protected attributes (race,",
  "gender, religion, national origin, disability), even if the narrative mentions",
  "them.",
  "",
  "Each rationale is 1-2 sentences, plain text with no markup. Return exactly one",
  "rationale per provided school id, keyed by that id.",
].join("\n");

/** Compact, model-facing view of one matched school — only citable facts. */
function schoolPayload(sc: ScoredCollege): Record<string, unknown> {
  const { college } = sc;
  return {
    id: college.id,
    name: college.name,
    satP25: college.satP25,
    satP75: college.satP75,
    admitRate: college.admitRate,
    netPrice: college.netPrice,
    pctNeedMet: college.pctNeedMet,
    programStrengths: college.programStrengths,
    tags: college.tags,
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
 * Fill each school's `rationale` from the model's keyed output.
 *
 * Invariant: the tier arrays and their colleges are untouched — only the
 * `rationale` field changes. An id the model returned that isn't in the list is
 * ignored; an id the list has but the model omitted gets `""`.
 */
export async function curate(o: {
  llm: LLMProvider;
  profile: StudentProfile;
  list: CollegeList;
}): Promise<CollegeList> {
  const { value } = await o.llm.generateObject({
    schema: CurateOutput,
    prompt: buildPrompt(o.profile, o.list),
    system: SYSTEM,
  });

  const fill = (sc: ScoredCollege): ScoredCollege => ({
    ...sc,
    rationale: value.rationales[sc.college.id] ?? NO_RATIONALE,
  });

  return CollegeList.parse({
    ...o.list,
    colleges: o.list.colleges.map(fill),
  });
}
