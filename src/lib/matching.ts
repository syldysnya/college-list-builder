/**
 * Deterministic matching engine — the app's core, most-defensible module.
 *
 * Turns a `StudentProfile` + the college dataset into a tiered `CollegeList`
 * (Reach / Target / Safety). Pure and framework-free: no LLM, no network, no
 * randomness, no `Date`. Every threshold and scoring weight below is a named
 * `const` (zero magic numbers) and every tier value is referenced via
 * `Tier.enum.*`, so the classification rules read exactly as specified.
 *
 * Layers:
 *   • `actToSat`     — ACT → SAT-equivalent concordance (clamped, interpolated).
 *   • `classifyTier` — admissibility bucket from stats + selectivity floor.
 *   • `fitScore`     — 0..100 weighted sum of program / constraint / aid / widen.
 *   • `buildList`    — classify + score + rank + flex-down into a `CollegeList`.
 */
import {
  Tier,
  Region,
  StudentProfile,
  College,
  ScoredCollege,
  CollegeList,
  ClimatePref,
  SizePref,
  SettingPref,
} from "./types";
import { tierTargets } from "./config";

// --- Tier thresholds (encode the classification rules exactly) ---------------
/** Below this admit rate a school is always a reach — overrides raw stats. */
export const SELECTIVITY_FLOOR = 0.15;
/** A school above the student's scores is only a safety at/above this admit rate. */
export const SAFETY_ADMIT_MIN = 0.4;
/** In the no-score band, below this admit rate is a target; at/above it is a safety. */
export const TARGET_ADMIT_MAX = 0.5;

// --- SAT bounds --------------------------------------------------------------
const SAT_MIN = 400;
const SAT_MAX = 1600;

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
export const W_PROGRAM = 50;
/** Climate / setting / size / distance preference satisfaction. */
export const W_CONSTRAINTS = 30;
/** Affordability, only when the student needs aid (otherwise neutral). */
export const W_AID = 12;
/** Small bias toward strong-fit, less-selective schools (widen the list). */
export const W_WIDEN = 8;

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
/** Admit rate at/above which the widen bias is fully saturated. */
const WIDEN_ADMIT_CAP = 0.5;

/** Human-readable assumption notes (de-duped in `buildList`). */
const ASSUMPTION_NO_SCORES =
  "No test scores provided — admissibility estimated from admit rates.";
const ASSUMPTION_TEST_OPTIONAL =
  "Some schools are test-optional — admissibility for those estimated from admit rates.";

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
 * Bucket a college into Reach / Target / Safety for this student.
 *
 * Order matters: the selectivity floor is checked first and overrides raw
 * stats — a top student never gets a sub-15%-admit school as a target/safety.
 */
export function classifyTier(profile: StudentProfile, c: College): Tier {
  // 1. Selectivity floor — overrides everything below.
  if (c.admitRate < SELECTIVITY_FLOOR) return Tier.enum.reach;

  const sat = effectiveSat(profile);

  // 2. Score is known and the school publishes an admitted-student range.
  if (sat != null && c.satP25 != null && c.satP75 != null) {
    if (sat < c.satP25) return Tier.enum.reach;
    if (sat <= c.satP75) return Tier.enum.target;
    // Above the published range: a safety only if it also admits broadly.
    return c.admitRate >= SAFETY_ADMIT_MIN ? Tier.enum.safety : Tier.enum.target;
  }

  // 3. No usable score (missing, or test-optional school): band on admit rate.
  // (admitRate < SELECTIVITY_FLOOR already handled as reach above.)
  return c.admitRate < TARGET_ADMIT_MAX ? Tier.enum.target : Tier.enum.safety;
}

// --- fitScore components (each returns 0..1) ---------------------------------

/** Lowercase alphanumeric tokens of a phrase (e.g. "Computer Science" → ["computer","science"]). */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

/** Does an interest phrase overlap any of the school's strengths/tags? */
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

/** Fraction of the student's interests the school is strong in (0..1); neutral if none. */
function programComponent(profile: StudentProfile, c: College): number {
  if (profile.interests.length === 0) return NEUTRAL;
  const schoolPhrases = [...c.programStrengths, ...c.tags];
  const schoolTokens = new Set<string>();
  for (const phrase of schoolPhrases) {
    for (const token of tokenize(phrase)) schoolTokens.add(token);
  }
  let matched = 0;
  for (const interest of profile.interests) {
    if (interestMatches(interest, schoolPhrases, schoolTokens)) matched += 1;
  }
  return matched / profile.interests.length;
}

function sizeBucket(enrollment: number): SizePref {
  if (enrollment <= SMALL_MAX) return SizePref.enum.small;
  if (enrollment >= LARGE_MIN) return SizePref.enum.large;
  return SizePref.enum.medium;
}

/** Average satisfaction of the climate / setting / size / distance constraints (0..1). */
function constraintComponent(profile: StudentProfile, c: College): number {
  const { climate, setting, size, homeState } = profile.constraints;

  const climateScore =
    climate === ClimatePref.enum.none ? NEUTRAL : climate === c.climate ? 1 : 0;

  const settingScore =
    setting === SettingPref.enum.none ? NEUTRAL : setting === c.setting ? 1 : 0;

  const sizeScore = size === SizePref.enum.none ? NEUTRAL : size === sizeBucket(c.enrollment) ? 1 : 0;

  let distanceScore: number;
  if (homeState == null) {
    distanceScore = NEUTRAL;
  } else if (homeState.trim().toUpperCase() === c.state.toUpperCase()) {
    distanceScore = DISTANCE_SAME_STATE;
  } else if (STATE_TO_REGION[homeState.trim().toUpperCase()] === c.region) {
    distanceScore = DISTANCE_SAME_REGION;
  } else {
    distanceScore = DISTANCE_ELSEWHERE;
  }

  return (climateScore + settingScore + sizeScore + distanceScore) / 4;
}

/** Affordability (0..1): rewards high need-met + low net price. Neutral if aid not needed. */
function aidComponent(profile: StudentProfile, c: College): number {
  if (!profile.constraints.needsFinancialAid) return NEUTRAL;
  const needMet = c.pctNeedMet == null ? NEUTRAL : clamp(c.pctNeedMet, 0, 1);
  const priceScore =
    c.netPrice == null
      ? NEUTRAL
      : clamp((NET_PRICE_WORST - c.netPrice) / (NET_PRICE_WORST - NET_PRICE_BEST), 0, 1);
  return (needMet + priceScore) / 2;
}

/** Small boost toward less-selective schools, saturating at `WIDEN_ADMIT_CAP` (0..1). */
function widenComponent(c: College): number {
  return clamp(c.admitRate / WIDEN_ADMIT_CAP, 0, 1);
}

/**
 * Overall fit for a student/college pair, 0..100. Weighted sum of the four
 * named components; each component is already normalized to 0..1 and the
 * weights sum to 100, so the result is bounded to [0, 100].
 */
export function fitScore(profile: StudentProfile, c: College): number {
  return (
    programComponent(profile, c) * W_PROGRAM +
    constraintComponent(profile, c) * W_CONSTRAINTS +
    aidComponent(profile, c) * W_AID +
    widenComponent(c) * W_WIDEN
  );
}

/** A school was tiered off admit rate despite the student having a score. */
function isTestOptionalTiered(profile: StudentProfile, c: College): boolean {
  return effectiveSat(profile) != null && (c.satP25 == null || c.satP75 == null);
}

/** Sort by fit desc, breaking ties by id for a fully deterministic order. */
function byFitThenId(a: ScoredCollege, b: ScoredCollege): number {
  if (b.fitScore !== a.fitScore) return b.fitScore - a.fitScore;
  return a.college.id < b.college.id ? -1 : a.college.id > b.college.id ? 1 : 0;
}

/**
 * Build the ranked Reach/Target/Safety list for a student.
 *
 * Each college is classified into exactly one tier (so no id can appear
 * twice), scored, then within each tier ranked by fit and truncated to
 * `tierTargets.perTier`. Tiers **flex down**: a thin tier is never padded —
 * `tierTargets.min` is a desired floor, not a hard fill. `rationale` is left
 * empty for a later LLM pass. The result is validated before return.
 */
export function buildList(profile: StudentProfile, colleges: College[]): CollegeList {
  const buckets: Record<Tier, ScoredCollege[]> = {
    [Tier.enum.reach]: [],
    [Tier.enum.target]: [],
    [Tier.enum.safety]: [],
  };
  const assumptions: string[] = [];
  const noScores = effectiveSat(profile) == null;
  if (noScores) assumptions.push(ASSUMPTION_NO_SCORES);
  let sawTestOptional = false;

  for (const c of colleges) {
    const tier = classifyTier(profile, c);
    buckets[tier].push({ college: c, fitScore: fitScore(profile, c), tier, rationale: "" });
    if (isTestOptionalTiered(profile, c)) sawTestOptional = true;
  }

  if (sawTestOptional && !noScores) assumptions.push(ASSUMPTION_TEST_OPTIONAL);

  const take = (tier: Tier): ScoredCollege[] =>
    [...buckets[tier]].sort(byFitThenId).slice(0, tierTargets.perTier);

  return CollegeList.parse({
    studentName: profile.name ?? DEFAULT_STUDENT_NAME,
    assumptions,
    reach: take(Tier.enum.reach),
    target: take(Tier.enum.target),
    safety: take(Tier.enum.safety),
  });
}
