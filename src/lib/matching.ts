/**
 * Deterministic matching engine — the app's core, most-defensible module.
 *
 * Turns a `StudentProfile` + the college dataset into a single `CollegeList`
 * ranked most-likely-to-be-admitted first. Pure and framework-free: no LLM, no
 * network, no randomness, no `Date`. Every threshold and weight below is a named
 * `const` (zero magic numbers) so the rules read exactly as specified.
 *
 * Layers:
 *   • `actToSat`     — ACT → SAT-equivalent concordance (clamped, interpolated).
 *   • `admitChance`  — 0..1 acceptance likelihood from stats vs the school's band.
 *   • `fitScore`     — 0..100 weighted sum of program / distance / preferences / aid.
 *   • `buildList`    — score every school, rank by chance-and-fit, take the top N.
 */
import {
  Region,
  StudentProfile,
  College,
  ScoredCollege,
  CollegeList,
  ClimatePref,
  SizePref,
  SettingPref,
} from "./types";
import { listTargets } from "./config";
import { cosine, calibrate } from "./embeddings";

// --- SAT bounds --------------------------------------------------------------
const SAT_MIN = 400;
const SAT_MAX = 1600;

// --- Admit-chance model ------------------------------------------------------
/** Multipliers on a school's base admit rate by where the student sits in its band. */
const CHANCE_ABOVE_P75 = 1.4; // above the 75th percentile → stronger
const CHANCE_ABOVE_MEDIAN = 1.15;
const CHANCE_ABOVE_P25 = 0.85;
const CHANCE_BELOW_P25 = 0.55; // below the range → weaker
const CHANCE_MIN = 0.01;
const CHANCE_MAX = 0.99;

// --- Prestige model (grounded: selectivity + academic strength) --------------
const PRESTIGE_W_SELECTIVITY = 0.6;
const PRESTIGE_W_ACADEMIC = 0.4;
/** SAT midpoint normalized across [SAT_STRENGTH_FLOOR, SAT_MAX] → 0..1. */
const SAT_STRENGTH_FLOOR = 800;

// --- ACT → SAT concordance (official-ish; ascending by ACT) ------------------
const ACT_SAT_TABLE: ReadonlyArray<{ act: number; sat: number }> = [
  { act: 20, sat: 1040 },
  { act: 21, sat: 1080 },
  { act: 22, sat: 1110 },
  { act: 23, sat: 1140 },
  { act: 24, sat: 1180 },
  { act: 25, sat: 1210 },
  { act: 26, sat: 1240 },
  { act: 27, sat: 1280 },
  { act: 28, sat: 1310 },
  { act: 29, sat: 1340 },
  { act: 30, sat: 1370 },
  { act: 31, sat: 1400 },
  { act: 32, sat: 1430 },
  { act: 33, sat: 1460 },
  { act: 34, sat: 1500 },
  { act: 35, sat: 1540 },
  { act: 36, sat: 1590 },
];

// --- fitScore weights (named; sum to 100) ------------------------------------
/** Program/interest overlap — the single most important signal. */
export const W_PROGRAM = 40;
/** Geography: how close the school is to the student's home (heavily weighted). */
export const W_DISTANCE = 30;
/** Climate / setting / size preference satisfaction. */
export const W_PREFERENCES = 15;
/** Affordability, only when the student needs aid (otherwise neutral). */
export const W_AID = 15;

// --- Scoring helpers (named — no bare literals at call sites) -----------------
/** Neutral score for a component with no signal (never rewards nor penalizes). */
const NEUTRAL = 0.5;
/** Enrollment ceiling for a "small" school. */
export const SMALL_MAX = 3000;
/** Enrollment floor for a "large" school. */
export const LARGE_MIN = 20000;
/** Same-region distance credit (vs 1 same-state, 0.2 elsewhere). */
const DISTANCE_SAME_REGION = 0.6;
const DISTANCE_SAME_STATE = 1;
const DISTANCE_ELSEWHERE = 0.2;
/** Net price mapped linearly to 1..0 across this range (lower price ⇒ better). */
const NET_PRICE_BEST = 0;
const NET_PRICE_WORST = 40000;

/** Human-readable assumption notes (de-duped in `buildList`). */
const ASSUMPTION_NO_SCORES =
  "No test scores provided, so admissibility is estimated from admit rates.";
const ASSUMPTION_TEST_OPTIONAL =
  "Some schools are test-optional, so admissibility for those is estimated from admit rates.";

/** Fallback student name; the client overrides with the real name for the PDF. */
const DEFAULT_STUDENT_NAME = "Student";

// --- State → Census region (for the distance constraint) ---------------------
const STATE_TO_REGION: Readonly<Record<string, Region>> = {
  CT: Region.enum.northeast,
  ME: Region.enum.northeast,
  MA: Region.enum.northeast,
  NH: Region.enum.northeast,
  RI: Region.enum.northeast,
  VT: Region.enum.northeast,
  NJ: Region.enum.northeast,
  NY: Region.enum.northeast,
  PA: Region.enum.northeast,
  IL: Region.enum.midwest,
  IN: Region.enum.midwest,
  MI: Region.enum.midwest,
  OH: Region.enum.midwest,
  WI: Region.enum.midwest,
  IA: Region.enum.midwest,
  KS: Region.enum.midwest,
  MN: Region.enum.midwest,
  MO: Region.enum.midwest,
  NE: Region.enum.midwest,
  ND: Region.enum.midwest,
  SD: Region.enum.midwest,
  DE: Region.enum.south,
  FL: Region.enum.south,
  GA: Region.enum.south,
  MD: Region.enum.south,
  NC: Region.enum.south,
  SC: Region.enum.south,
  VA: Region.enum.south,
  DC: Region.enum.south,
  WV: Region.enum.south,
  AL: Region.enum.south,
  KY: Region.enum.south,
  MS: Region.enum.south,
  TN: Region.enum.south,
  AR: Region.enum.south,
  LA: Region.enum.south,
  OK: Region.enum.south,
  TX: Region.enum.south,
  AZ: Region.enum.west,
  CO: Region.enum.west,
  ID: Region.enum.west,
  MT: Region.enum.west,
  NV: Region.enum.west,
  NM: Region.enum.west,
  UT: Region.enum.west,
  WY: Region.enum.west,
  AK: Region.enum.west,
  CA: Region.enum.west,
  HI: Region.enum.west,
  OR: Region.enum.west,
  WA: Region.enum.west,
};

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** Linearly interpolate the SAT value for `act` between two table anchors. */
function interpolateSat(
  act: number,
  lo: { act: number; sat: number },
  hi: { act: number; sat: number }
): number {
  if (hi.act === lo.act) return lo.sat;
  const t = (act - lo.act) / (hi.act - lo.act);
  return lo.sat + t * (hi.sat - lo.sat);
}

/**
 * ACT → SAT-equivalent via the concordance table, with linear interpolation
 * between anchors and linear extrapolation past either end. Result is rounded
 * and clamped to the valid SAT range [400, 1600].
 */
export function actToSat(act: number): number {
  const first = ACT_SAT_TABLE[0];
  const last = ACT_SAT_TABLE[ACT_SAT_TABLE.length - 1];
  if (first === undefined || last === undefined) return SAT_MIN;

  let sat: number;
  if (act <= first.act) {
    // Extrapolate below the table using its first two anchors.
    const second = ACT_SAT_TABLE[1] ?? first;
    sat = interpolateSat(act, first, second);
  } else if (act >= last.act) {
    sat = last.sat;
  } else {
    // Find the bracketing anchors.
    let lo = first;
    let hi = last;
    for (let i = 0; i < ACT_SAT_TABLE.length - 1; i += 1) {
      const a = ACT_SAT_TABLE[i];
      const b = ACT_SAT_TABLE[i + 1];
      if (a !== undefined && b !== undefined && act >= a.act && act <= b.act) {
        lo = a;
        hi = b;
        break;
      }
    }
    sat = interpolateSat(act, lo, hi);
  }
  return clamp(Math.round(sat), SAT_MIN, SAT_MAX);
}

/** Best-available SAT-equivalent for a profile: explicit SAT, else ACT, else null. */
function effectiveSat(profile: StudentProfile): number | null {
  if (profile.sat != null) return profile.sat;
  if (profile.act != null) return actToSat(profile.act);
  return null;
}

/**
 * Estimated probability the student is admitted, 0..1. Starts from the school's
 * base admit rate and scales it by where the student's score sits in the
 * school's admitted-student band. With no usable score (missing, or a
 * test-optional school with no band), the admit rate is used as-is.
 */
export function admitChance(profile: StudentProfile, c: College): number {
  const base = clamp(c.admitRate, 0, 1);
  const sat = effectiveSat(profile);
  if (sat == null || c.satP25 == null || c.satP75 == null) {
    return clamp(base, CHANCE_MIN, CHANCE_MAX);
  }
  const median = (c.satP25 + c.satP75) / 2;
  let mult: number;
  if (sat >= c.satP75) mult = CHANCE_ABOVE_P75;
  else if (sat >= median) mult = CHANCE_ABOVE_MEDIAN;
  else if (sat >= c.satP25) mult = CHANCE_ABOVE_P25;
  else mult = CHANCE_BELOW_P25;
  return clamp(base * mult, CHANCE_MIN, CHANCE_MAX);
}

// --- fitScore components (each returns 0..1) ---------------------------------

/** Lowercase alphanumeric tokens of a phrase (e.g. "Computer Science" → ["computer","science"]). */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

/** Does an interest phrase overlap any of the school's programs? */
function interestMatches(interest: string, schoolPhrases: string[], schoolTokens: Set<string>): boolean {
  const needle = interest.toLowerCase().trim();
  if (needle.length === 0) return false;
  // Substring either direction on the full phrase.
  for (const phrase of schoolPhrases) {
    const hay = phrase.toLowerCase();
    if (hay.includes(needle) || needle.includes(hay)) return true;
  }
  // Token-level overlap.
  for (const token of tokenize(interest)) {
    if (schoolTokens.has(token)) return true;
  }
  return false;
}

/**
 * Request-scoped semantic inputs. `interestVectors` is aligned by index with
 * `profile.interests`; `collegeVectors` maps college id -> its program vector.
 * `null` anywhere downstream means keyword-only (no embeddings available).
 */
export interface SemanticContext {
  interestVectors: Float32Array[];
  collegeVectors: Map<string, Float32Array>;
}

/**
 * Fraction of the student's interests the school is strong in (0..1); neutral if
 * none. Per interest, the score is `max(exact-keyword hit, calibrated cosine)` —
 * semantic similarity can only RAISE a score the keyword match missed, so exact
 * matches stay authoritative. Keyword-only when `semantic` is null or the college
 * has no vector.
 */
function programComponent(profile: StudentProfile, c: College, semantic: SemanticContext | null): number {
  if (profile.interests.length === 0) return NEUTRAL;
  const schoolPhrases = c.programs;
  const schoolTokens = new Set<string>();
  for (const phrase of schoolPhrases) {
    for (const token of tokenize(phrase)) schoolTokens.add(token);
  }
  const collegeVec = semantic?.collegeVectors.get(c.id) ?? null;

  let total = 0;
  for (let i = 0; i < profile.interests.length; i += 1) {
    const interest = profile.interests[i] ?? "";
    const keyword = interestMatches(interest, schoolPhrases, schoolTokens) ? 1 : 0;
    let sem = 0;
    const interestVec = semantic?.interestVectors[i] ?? null;
    if (collegeVec !== null && interestVec != null) {
      sem = calibrate(cosine(interestVec, collegeVec));
    }
    total += Math.max(keyword, sem);
  }
  return total / profile.interests.length;
}

function sizeBucket(enrollment: number): SizePref {
  if (enrollment <= SMALL_MAX) return SizePref.enum.small;
  if (enrollment >= LARGE_MIN) return SizePref.enum.large;
  return SizePref.enum.medium;
}

/** Geography satisfaction (0..1): same-state best, same-region good, elsewhere low; neutral if no home state. */
function distanceComponent(profile: StudentProfile, c: College): number {
  const { homeState } = profile.constraints;
  if (homeState == null) return NEUTRAL;
  const home = homeState.trim().toUpperCase();
  if (home === c.state.toUpperCase()) return DISTANCE_SAME_STATE;
  if (STATE_TO_REGION[home] === c.region) return DISTANCE_SAME_REGION;
  return DISTANCE_ELSEWHERE;
}

/** Average satisfaction of the climate / setting / size preferences (0..1). */
function preferencesComponent(profile: StudentProfile, c: College): number {
  const { climate, setting, size } = profile.constraints;
  const climateScore = climate === ClimatePref.enum.none ? NEUTRAL : climate === c.climate ? 1 : 0;
  const settingScore = setting === SettingPref.enum.none ? NEUTRAL : setting === c.setting ? 1 : 0;
  const sizeScore = size === SizePref.enum.none ? NEUTRAL : size === sizeBucket(c.enrollment) ? 1 : 0;
  return (climateScore + settingScore + sizeScore) / 3;
}

/** Affordability (0..1): rewards a low net price. Neutral if aid not needed or price unknown. */
function aidComponent(profile: StudentProfile, c: College): number {
  if (!profile.constraints.needsFinancialAid) return NEUTRAL;
  if (c.netPrice == null) return NEUTRAL;
  return clamp((NET_PRICE_WORST - c.netPrice) / (NET_PRICE_WORST - NET_PRICE_BEST), 0, 1);
}

/**
 * Overall fit for a student/college pair, 0..100. Weighted sum of program,
 * distance, preferences, and aid; each component is 0..1 and the weights sum to
 * 100, so the result is bounded to [0, 100]. Selectivity is NOT part of fit — it
 * is handled by the selectivity buckets in `buildList`.
 */
export function fitScore(
  profile: StudentProfile,
  c: College,
  semantic: SemanticContext | null = null
): number {
  return (
    programComponent(profile, c, semantic) * W_PROGRAM +
    distanceComponent(profile, c) * W_DISTANCE +
    preferencesComponent(profile, c) * W_PREFERENCES +
    aidComponent(profile, c) * W_AID
  );
}

/** The student has a score but the school publishes no band (test-optional). */
function hasScoreButNoBand(profile: StudentProfile, c: College): boolean {
  return effectiveSat(profile) != null && (c.satP25 == null || c.satP75 == null);
}

/** Prestige (0..1) from grounded signals: selectivity plus academic strength. */
export function prestige(c: College): number {
  const selectivity = clamp(1 - c.admitRate, 0, 1);
  let academic = NEUTRAL;
  if (c.satP25 != null && c.satP75 != null) {
    const midpoint = (c.satP25 + c.satP75) / 2;
    academic = clamp((midpoint - SAT_STRENGTH_FLOOR) / (SAT_MAX - SAT_STRENGTH_FLOOR), 0, 1);
  }
  return PRESTIGE_W_SELECTIVITY * selectivity + PRESTIGE_W_ACADEMIC * academic;
}

// --- Selectivity buckets + list composition ----------------------------------
/** admitChance below this → "reach". */
const REACH_ADMIT_MAX = 0.3;
/** admitChance at/above this → "safety"; between the two → "target". */
const SAFETY_ADMIT_MIN = 0.75;
/** Guaranteed spread; these MUST sum to listTargets.max. */
const REACH_SLOTS = 3;
const TARGET_SLOTS = 5;
const SAFETY_SLOTS = 4;

type Bucket = "reach" | "target" | "safety";

function bucketOf(admitChance: number): Bucket {
  if (admitChance < REACH_ADMIT_MAX) return "reach";
  if (admitChance >= SAFETY_ADMIT_MIN) return "safety";
  return "target";
}

/** Deterministic order: highest fit first, then more-prestigious, then id. */
function byFitThenPrestige(a: ScoredCollege, b: ScoredCollege): number {
  if (b.fitScore !== a.fitScore) return b.fitScore - a.fitScore;
  const pa = prestige(a.college);
  const pb = prestige(b.college);
  if (pb !== pa) return pb - pa;
  return a.college.id < b.college.id ? -1 : a.college.id > b.college.id ? 1 : 0;
}

/**
 * Select up to `listTargets.max` colleges as a selectivity spread. Each bucket
 * (reach/target/safety) contributes up to its quota of best-fit schools; any
 * shortfall is backfilled from the best-fit unpicked schools of any bucket, so
 * the list is always as full as the data allows. The returned list is ordered
 * best-fit-first.
 */
function selectSpread(scored: ScoredCollege[]): ScoredCollege[] {
  const buckets: Record<Bucket, ScoredCollege[]> = { reach: [], target: [], safety: [] };
  for (const sc of scored) buckets[bucketOf(sc.admitChance)].push(sc);
  const quota: Record<Bucket, number> = {
    reach: REACH_SLOTS,
    target: TARGET_SLOTS,
    safety: SAFETY_SLOTS,
  };

  const picked: ScoredCollege[] = [];
  const pickedIds = new Set<string>();
  for (const key of ["reach", "target", "safety"] as Bucket[]) {
    for (const sc of [...buckets[key]].sort(byFitThenPrestige).slice(0, quota[key])) {
      picked.push(sc);
      pickedIds.add(sc.college.id);
    }
  }

  if (picked.length < listTargets.max) {
    const rest = scored.filter((sc) => !pickedIds.has(sc.college.id)).sort(byFitThenPrestige);
    for (const sc of rest) {
      if (picked.length >= listTargets.max) break;
      picked.push(sc);
    }
  }

  return picked.sort(byFitThenPrestige).slice(0, listTargets.max);
}

/**
 * Build the ranked college list for a student.
 *
 * Every college is scored for fit and acceptance chance, then selected as a
 * selectivity spread: each reach/target/safety bucket contributes its
 * best-fit schools up to a guaranteed quota, backfilled to `listTargets.max`
 * and ordered best-fit-first. `rationale` is left empty for a later LLM pass.
 * The result is validated before return.
 */
export function buildList(
  profile: StudentProfile,
  colleges: College[],
  semantic: SemanticContext | null = null
): CollegeList {
  const assumptions: string[] = [];
  const noScores = effectiveSat(profile) == null;
  if (noScores) assumptions.push(ASSUMPTION_NO_SCORES);
  let sawTestOptional = false;

  const scored: ScoredCollege[] = colleges.map((c) => {
    if (hasScoreButNoBand(profile, c)) sawTestOptional = true;
    return {
      college: c,
      fitScore: fitScore(profile, c, semantic),
      admitChance: admitChance(profile, c),
      rationale: "",
    };
  });

  if (sawTestOptional && !noScores) assumptions.push(ASSUMPTION_TEST_OPTIONAL);

  const ranked = selectSpread(scored);

  return CollegeList.parse({
    studentName: profile.name ?? DEFAULT_STUDENT_NAME,
    assumptions,
    colleges: ranked,
  });
}
