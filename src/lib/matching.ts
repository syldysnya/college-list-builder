/**
 * Deterministic matching engine — the app's core, most-defensible module.
 *
 * Turns a `StudentProfile` + the college dataset into a single `CollegeList`
 * ordered best-ranked first, guaranteed to span a reach/target/safety spread. Pure
 * and framework-free: no LLM, no network, no randomness, no `Date`. Every
 * threshold and weight below is a named `const` (zero magic numbers) so the
 * rules read exactly as specified.
 *
 * Layers:
 *   • `actToSat`     — ACT → SAT-equivalent concordance (clamped, interpolated).
 *   • `admitChance`  — 0..1 acceptance likelihood from stats vs the school's band.
 *   • `fitScore`     — 0..100 weighted sum of program / distance / preferences / aid.
 *   • `buildList`    — bucket by admit chance, fill a rank-ordered selectivity spread.
 */
import {
  Region,
  StudentProfile,
  College,
  ScoredCollege,
  CollegeList,
  ClimatePref,
  DistancePref,
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
/**
 * Distance tiers (0..1) by how far the student will travel. "close" keeps a
 * strong home-state pull; "regional" (and the default when unspecified) treats
 * home and bordering states as nearly equal, i.e. "not too far from home",
 * letting the best schools just across the border compete. Everywhere else is
 * heavily penalized in both modes. "anywhere" disables geography (handled in
 * `distanceComponent`).
 */
const DISTANCE_TIERS = {
  close: { sameState: 1, adjacent: 0.75, sameRegion: 0.3, elsewhere: 0.15 },
  regional: { sameState: 1, adjacent: 0.95, sameRegion: 0.7, elsewhere: 0.15 },
} as const;
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

// --- Bordering states (undirected), for the "close to home" distance tier -----
const ADJACENT_STATES: Readonly<Record<string, readonly string[]>> = {
  AL: ["FL", "GA", "MS", "TN"], AK: [], AZ: ["CA", "CO", "NV", "NM", "UT"],
  AR: ["LA", "MO", "MS", "OK", "TN", "TX"], CA: ["AZ", "NV", "OR"],
  CO: ["AZ", "KS", "NE", "NM", "OK", "UT", "WY"], CT: ["MA", "NY", "RI"],
  DE: ["MD", "NJ", "PA"], FL: ["AL", "GA"], GA: ["AL", "FL", "NC", "SC", "TN"], HI: [],
  ID: ["MT", "NV", "OR", "UT", "WA", "WY"], IL: ["IN", "IA", "KY", "MO", "WI"],
  IN: ["IL", "KY", "MI", "OH"], IA: ["IL", "MN", "MO", "NE", "SD", "WI"],
  KS: ["CO", "MO", "NE", "OK"], KY: ["IL", "IN", "MO", "OH", "TN", "VA", "WV"],
  LA: ["AR", "MS", "TX"], ME: ["NH"], MD: ["DE", "PA", "VA", "WV", "DC"],
  MA: ["CT", "NH", "NY", "RI", "VT"], MI: ["IN", "OH", "WI"], MN: ["IA", "ND", "SD", "WI"],
  MS: ["AL", "AR", "LA", "TN"], MO: ["AR", "IA", "IL", "KS", "KY", "NE", "OK", "TN"],
  MT: ["ID", "ND", "SD", "WY"], NE: ["CO", "IA", "KS", "MO", "SD", "WY"],
  NV: ["AZ", "CA", "ID", "OR", "UT"], NH: ["MA", "ME", "VT"], NJ: ["DE", "NY", "PA"],
  NM: ["AZ", "CO", "OK", "TX", "UT"], NY: ["CT", "MA", "NJ", "PA", "VT"],
  NC: ["GA", "SC", "TN", "VA"], ND: ["MN", "MT", "SD"], OH: ["IN", "KY", "MI", "PA", "WV"],
  OK: ["AR", "CO", "KS", "MO", "NM", "TX"], OR: ["CA", "ID", "NV", "WA"],
  PA: ["DE", "MD", "NJ", "NY", "OH", "WV"], RI: ["CT", "MA"], SC: ["GA", "NC"],
  SD: ["IA", "MN", "MT", "NE", "ND", "WY"],
  TN: ["AL", "AR", "GA", "KY", "MO", "MS", "NC", "VA"], TX: ["AR", "LA", "NM", "OK"],
  UT: ["AZ", "CO", "ID", "NV", "NM", "WY"], VT: ["MA", "NH", "NY"],
  VA: ["KY", "MD", "NC", "TN", "WV", "DC"], WA: ["ID", "OR"], WV: ["KY", "MD", "OH", "PA", "VA"],
  WI: ["IA", "IL", "MI", "MN"], WY: ["CO", "ID", "MT", "NE", "SD", "UT"], DC: ["MD", "VA"],
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

/**
 * Geography satisfaction (0..1): home state, then a bordering state, then same
 * Census region, then elsewhere. Neutral (no signal) when the student gave no
 * home state or explicitly said distance does not matter ("anywhere"). When they
 * said "regional", same-region schools are treated more generously.
 */
function distanceComponent(profile: StudentProfile, c: College): number {
  const { homeState, maxDistance } = profile.constraints;
  if (homeState == null || maxDistance === DistancePref.enum.anywhere) return NEUTRAL;
  // Only "close" applies the strong home-state pull; "regional" and the default
  // (unspecified) treat home and neighboring states as nearly equal.
  const tier = maxDistance === DistancePref.enum.close ? DISTANCE_TIERS.close : DISTANCE_TIERS.regional;
  const home = homeState.trim().toUpperCase();
  const state = c.state.toUpperCase();
  if (home === state) return tier.sameState;
  if ((ADJACENT_STATES[home] ?? []).includes(state)) return tier.adjacent;
  if (STATE_TO_REGION[home] === c.region) return tier.sameRegion;
  return tier.elsewhere;
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

/**
 * How much prestige counts in ranking, in fitScore points. prestige is 0..1, so
 * a most-reputable school gets up to this many points — enough to surface the
 * best schools a student can get into within each tier. Like geography, it is
 * gated by program relevance (below), so it never lifts an off-field school.
 */
const PRESTIGE_RANK_WEIGHT = 35;

/**
 * Program relevance used to gate geography and prestige: 1 when the student
 * stated no interests (nothing to gate on, so geography/prestige apply in full),
 * otherwise the program-match fraction (0..1). A school that does not fit the
 * student's field gets little lift from being close or prestigious.
 */
function relevanceGate(profile: StudentProfile, program: number): number {
  return profile.interests.length === 0 ? 1 : program;
}

/**
 * Ranking score for ordering the list (not shown to the user; `fitScore` stays
 * the raw fit). This is the raw fit plus a prestige bonus that is gated by
 * program relevance — a selective school that does not fit the student's field
 * gets no prestige lift (so an art college does not outrank CS schools for a
 * CS student), while geography still anchors the list to nearby schools.
 */
function rankScore(profile: StudentProfile, c: College, semantic: SemanticContext | null): number {
  const program = programComponent(profile, c, semantic);
  const relevance = relevanceGate(profile, program);
  return (
    fitScore(profile, c, semantic) + prestige(c) * PRESTIGE_RANK_WEIGHT * relevance
  );
}

/** A scored college paired with its precomputed ranking score. */
interface RankedCollege {
  sc: ScoredCollege;
  rank: number;
}

/** Deterministic order: highest rank first, then id. */
function byRankDesc(a: RankedCollege, b: RankedCollege): number {
  if (b.rank !== a.rank) return b.rank - a.rank;
  return a.sc.college.id < b.sc.college.id ? -1 : a.sc.college.id > b.sc.college.id ? 1 : 0;
}

/**
 * Select up to `listTargets.max` colleges as a selectivity spread. Each bucket
 * (reach/target/safety) contributes up to its quota of top-ranked schools; any
 * shortfall is backfilled from the top-ranked unpicked schools of any bucket, so
 * the list is always as full as the data allows. The returned list is ordered
 * best-ranked-first.
 */
function selectSpread(items: RankedCollege[]): ScoredCollege[] {
  const buckets: Record<Bucket, RankedCollege[]> = { reach: [], target: [], safety: [] };
  for (const it of items) buckets[bucketOf(it.sc.admitChance)].push(it);
  const quota: Record<Bucket, number> = {
    reach: REACH_SLOTS,
    target: TARGET_SLOTS,
    safety: SAFETY_SLOTS,
  };

  const picked: RankedCollege[] = [];
  const pickedIds = new Set<string>();
  for (const key of ["reach", "target", "safety"] as Bucket[]) {
    for (const it of [...buckets[key]].sort(byRankDesc).slice(0, quota[key])) {
      picked.push(it);
      pickedIds.add(it.sc.college.id);
    }
  }

  if (picked.length < listTargets.max) {
    const rest = items.filter((it) => !pickedIds.has(it.sc.college.id)).sort(byRankDesc);
    for (const it of rest) {
      if (picked.length >= listTargets.max) break;
      picked.push(it);
    }
  }

  return picked
    .sort(byRankDesc)
    .slice(0, listTargets.max)
    .map((it) => it.sc);
}

/**
 * Build the ranked college list for a student.
 *
 * Every college is scored for fit and acceptance chance, then selected as a
 * selectivity spread: each reach/target/safety bucket contributes its
 * best-ranked schools up to a guaranteed quota, backfilled to `listTargets.max`
 * and ordered best-ranked-first. `rationale` is left empty for a later LLM pass.
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

  const scored: RankedCollege[] = colleges.map((c) => {
    if (hasScoreButNoBand(profile, c)) sawTestOptional = true;
    const sc: ScoredCollege = {
      college: c,
      fitScore: fitScore(profile, c, semantic),
      admitChance: admitChance(profile, c),
      rationale: "",
    };
    return { sc, rank: rankScore(profile, c, semantic) };
  });

  if (sawTestOptional && !noScores) assumptions.push(ASSUMPTION_TEST_OPTIONAL);

  const ranked = selectSpread(scored);

  return CollegeList.parse({
    studentName: profile.name ?? DEFAULT_STUDENT_NAME,
    assumptions,
    colleges: ranked,
  });
}
