/**
 * One-time sync: pull four-year U.S. colleges from the U.S. DOE College
 * Scorecard API and write them to `src/data/colleges.json` in our `College`
 * shape. Run with `npm run sync:scorecard`.
 *
 * The API key (DATA_GOV_API_KEY) resolves via env → macOS Keychain, the same
 * way the app resolves secrets. Only used here at sync time — never at runtime.
 *
 *   Grounding: every field comes from Scorecard/IPEDS. `setting` is derived from
 *   the IPEDS locale code, `type` from the Carnegie classification, `programs`
 *   from the real degree-share mix, and `climate` from a state → zone map (the
 *   one genuinely non-authoritative field). Rows are validated against the Zod
 *   `College` schema and invalid ones are dropped.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveSecret } from "../src/lib/secrets";
import { College, type College as CollegeT } from "../src/lib/types";

const API_KEY = resolveSecret("DATA_GOV_API_KEY");
if (!API_KEY) {
  throw new Error(
    "Missing DATA_GOV_API_KEY — set it as an env var, or in the macOS Keychain:\n" +
      "  security add-generic-password -a \"$USER\" -s DATA_GOV_API_KEY -w '<key>'"
  );
}

const BASE = "https://api.data.gov/ed/collegescorecard/v1/schools";
const PER_PAGE = 100;

const FIELDS = [
  "id",
  "school.name",
  "school.city",
  "school.state",
  "school.locale",
  "school.ownership",
  "school.carnegie_basic",
  "latest.admissions.admission_rate.overall",
  "latest.admissions.sat_scores.25th_percentile.critical_reading",
  "latest.admissions.sat_scores.25th_percentile.math",
  "latest.admissions.sat_scores.75th_percentile.critical_reading",
  "latest.admissions.sat_scores.75th_percentile.math",
  "latest.cost.avg_net_price.overall",
  "latest.student.size",
  "latest.academics.program_percentage",
].join(",");

// --- Derivation tables -------------------------------------------------------
const STATE_TO_REGION: Record<string, string> = {
  CT: "northeast", ME: "northeast", MA: "northeast", NH: "northeast", RI: "northeast",
  VT: "northeast", NJ: "northeast", NY: "northeast", PA: "northeast",
  IL: "midwest", IN: "midwest", MI: "midwest", OH: "midwest", WI: "midwest", IA: "midwest",
  KS: "midwest", MN: "midwest", MO: "midwest", NE: "midwest", ND: "midwest", SD: "midwest",
  DE: "south", FL: "south", GA: "south", MD: "south", NC: "south", SC: "south", VA: "south",
  DC: "south", WV: "south", AL: "south", KY: "south", MS: "south", TN: "south", AR: "south",
  LA: "south", OK: "south", TX: "south",
  AZ: "west", CO: "west", ID: "west", MT: "west", NV: "west", NM: "west", UT: "west",
  WY: "west", AK: "west", CA: "west", HI: "west", OR: "west", WA: "west",
};

// Warm states (Sun Belt + Pacific/Hawaii); everything else → cold.
const WARM_STATES = new Set([
  "FL", "GA", "SC", "NC", "AL", "MS", "LA", "TX", "AR", "TN", "OK",
  "AZ", "NM", "NV", "CA", "HI",
]);

const CIP_LABELS: Record<string, string> = {
  agriculture: "Agriculture", architecture: "Architecture", biological: "Biology",
  business_marketing: "Business", communication: "Communications",
  communications_technology: "Communications Tech", computer: "Computer Science",
  construction: "Construction", education: "Education", engineering: "Engineering",
  engineering_technology: "Engineering Tech", english: "English",
  ethnic_cultural_gender: "Ethnic & Gender Studies", family_consumer_science: "Consumer Sciences",
  health: "Health & Nursing", history: "History", humanities: "Humanities",
  language: "Languages", legal: "Legal Studies", library: "Library Science",
  mathematics: "Mathematics", mechanic_repair_technology: "Mechanic & Repair",
  military: "Military Science", multidiscipline: "Interdisciplinary Studies",
  parks_recreation_fitness: "Parks & Recreation", personal_culinary: "Culinary Arts",
  philosophy_religious: "Philosophy & Religion", physical_science: "Physical Sciences",
  precision_production: "Precision Production", psychology: "Psychology",
  public_administration_social_service: "Public Administration",
  resources: "Natural Resources", science_technology: "Science Technology",
  security_law_enforcement: "Criminal Justice", social_science: "Social Sciences",
  theology_religious_vocation: "Theology", transportation: "Transportation",
  visual_performing: "Visual & Performing Arts",
};

type Row = Record<string, unknown>;
const num = (r: Row, k: string): number | null => {
  const v = r[k];
  return typeof v === "number" ? v : null;
};
const str = (r: Row, k: string): string | null => {
  const v = r[k];
  return typeof v === "string" ? v : null;
};

function settingFromLocale(locale: number | null): "urban" | "suburban" | "rural" | null {
  if (locale == null) return null;
  const tens = Math.floor(locale / 10);
  if (tens === 1) return "urban"; // 11–13 City
  if (tens === 2) return "suburban"; // 21–23 Suburb
  if (tens === 3 || tens === 4) return "rural"; // 31–33 Town, 41–43 Rural
  return null;
}

function typeFromCarnegie(code: number | null): "research" | "liberal-arts" | "regional" | "other" {
  if (code == null) return "other";
  if (code >= 15 && code <= 17) return "research"; // Doctoral
  if (code >= 18 && code <= 20) return "regional"; // Master's
  if (code >= 21 && code <= 22) return "liberal-arts"; // Baccalaureate
  return "other";
}

/** Every field the school actually grants degrees in (share > 0), ordered by share. */
function programsOf(r: Row): string[] {
  const scored: Array<{ label: string; share: number }> = [];
  for (const [key, label] of Object.entries(CIP_LABELS)) {
    const share = num(r, `latest.academics.program_percentage.${key}`);
    if (share != null && share > 0) scored.push({ label, share });
  }
  scored.sort((a, b) => b.share - a.share);
  return scored.map((p) => p.label);
}

/** Map one Scorecard row to a validated College, or null to drop it. */
function toCollege(r: Row): CollegeT | null {
  const state = str(r, "school.state");
  const region = state ? STATE_TO_REGION[state.toUpperCase()] : undefined;
  const setting = settingFromLocale(num(r, "school.locale"));
  const admitRate = num(r, "latest.admissions.admission_rate.overall");
  const enrollment = num(r, "latest.student.size");
  const ownershipCode = num(r, "school.ownership");
  const name = str(r, "school.name");
  const city = str(r, "school.city");
  const idNum = num(r, "id");

  // Hard requirements — drop rows the matching engine can't rank.
  if (
    name == null || city == null || idNum == null || state == null || region === undefined ||
    setting == null || admitRate == null || enrollment == null || enrollment <= 0 ||
    ownershipCode == null || ownershipCode === 3 // exclude for-profit
  ) {
    return null;
  }

  const cr25 = num(r, "latest.admissions.sat_scores.25th_percentile.critical_reading");
  const m25 = num(r, "latest.admissions.sat_scores.25th_percentile.math");
  const cr75 = num(r, "latest.admissions.sat_scores.75th_percentile.critical_reading");
  const m75 = num(r, "latest.admissions.sat_scores.75th_percentile.math");
  const satP25 = cr25 != null && m25 != null ? cr25 + m25 : null;
  const satP75 = cr75 != null && m75 != null ? cr75 + m75 : null;

  const candidate = {
    id: String(idNum),
    name,
    city,
    state,
    region,
    satP25,
    satP75,
    admitRate,
    netPrice: num(r, "latest.cost.avg_net_price.overall"),
    enrollment,
    setting,
    climate: WARM_STATES.has(state.toUpperCase()) ? "warm" : "cold",
    ownership: ownershipCode === 1 ? "public" : "private",
    type: typeFromCarnegie(num(r, "school.carnegie_basic")),
    programs: programsOf(r),
  };

  const parsed = College.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

async function fetchPage(page: number): Promise<{ results: Row[]; total: number }> {
  const params = new URLSearchParams({
    api_key: API_KEY,
    fields: FIELDS,
    per_page: String(PER_PAGE),
    page: String(page),
    "school.operating": "1",
    "school.degrees_awarded.predominant": "3", // predominantly bachelor's → four-year
    "latest.admissions.admission_rate.overall__range": "0..1", // must have an admit rate
  });
  const res = await fetch(`${BASE}?${params.toString()}`);
  if (!res.ok) throw new Error(`Scorecard API ${res.status} on page ${page}`);
  const body = (await res.json()) as { results: Row[]; metadata: { total: number } };
  return { results: body.results, total: body.metadata.total };
}

async function main() {
  const colleges: CollegeT[] = [];
  let dropped = 0;
  const first = await fetchPage(0);
  const pages = Math.ceil(first.total / PER_PAGE);
  console.log(`Scorecard reports ${first.total} four-year schools with admit rates (${pages} pages).`);

  for (let page = 0; page < pages; page += 1) {
    const { results } = page === 0 ? first : await fetchPage(page);
    for (const row of results) {
      const c = toCollege(row);
      if (c) colleges.push(c);
      else dropped += 1;
    }
    if ((page + 1) % 5 === 0 || page === pages - 1) {
      console.log(`  page ${page + 1}/${pages} — kept ${colleges.length}, dropped ${dropped}`);
    }
  }

  colleges.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const outPath = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data", "colleges.json");
  writeFileSync(outPath, `${JSON.stringify(colleges, null, 2)}\n`);
  console.log(`\nWrote ${colleges.length} colleges to ${outPath} (dropped ${dropped}).`);
}

void main();
