/**
 * Core data types for the app, defined as Zod schemas with inferred TS types.
 * Framework-free: no imports from Next/React. Every later module (scoring,
 * chat, export) builds on the shapes defined here.
 *
 * Enum pattern — each domain is declared once as an `as const` tuple, then a
 * Zod schema is built from it. This gives three things from a single source:
 *   • the tuple  → iterate the domain          (e.g. `REGIONS.map(...)`)
 *   • the schema → validate + infer the type   (`Region`, `z.infer<typeof Region>`)
 *   • `.enum`    → named member access ("dict") (`Region.enum.west === "west"`)
 * Reference members via `.enum` so no bare string literal is ever written.
 */
import { z } from "zod";

// --- Enum domains (tuples) ---------------------------------------------------
export const REGIONS = ["northeast", "midwest", "south", "west"] as const;
export const COLLEGE_SETTINGS = ["urban", "suburban", "rural"] as const;
export const COLLEGE_CLIMATES = ["warm", "cold"] as const;
export const DISTANCE_PREFS = ["close", "regional", "anywhere"] as const;
export const CLIMATE_PREFS = ["warm", "cold", "none"] as const;
export const SIZE_PREFS = ["small", "medium", "large", "none"] as const;
export const SETTING_PREFS = ["urban", "suburban", "rural", "none"] as const;
export const CHAT_ROLES = ["counselor", "assistant"] as const;
export const CHAT_ACTIONS = ["list", "refuse"] as const;

// --- Enum schemas (validation + inferred type + `.enum` dict) ----------------
export const Region = z.enum(REGIONS);
export type Region = z.infer<typeof Region>;

export const CollegeSetting = z.enum(COLLEGE_SETTINGS);
export type CollegeSetting = z.infer<typeof CollegeSetting>;

export const CollegeClimate = z.enum(COLLEGE_CLIMATES);
export type CollegeClimate = z.infer<typeof CollegeClimate>;

export const DistancePref = z.enum(DISTANCE_PREFS);
export type DistancePref = z.infer<typeof DistancePref>;

export const ClimatePref = z.enum(CLIMATE_PREFS);
export type ClimatePref = z.infer<typeof ClimatePref>;

export const SizePref = z.enum(SIZE_PREFS);
export type SizePref = z.infer<typeof SizePref>;

export const SettingPref = z.enum(SETTING_PREFS);
export type SettingPref = z.infer<typeof SettingPref>;

export const ChatRole = z.enum(CHAT_ROLES);
export type ChatRole = z.infer<typeof ChatRole>;

export const ChatAction = z.enum(CHAT_ACTIONS);
export type ChatAction = z.infer<typeof ChatAction>;

// --- Core schemas ------------------------------------------------------------
export const StudentProfile = z.object({
  name: z.string().nullable(),
  gpa: z.number().min(0).max(4).nullable(),
  sat: z.number().min(400).max(1600).nullable(),
  act: z.number().min(1).max(36).nullable(),
  apScores: z.array(z.object({ subject: z.string(), score: z.number().min(1).max(5) })),
  interests: z.array(z.string()),
  constraints: z.object({
    homeState: z.string().nullable(),
    maxDistance: DistancePref.nullable(),
    climate: ClimatePref,
    needsFinancialAid: z.boolean(),
    size: SizePref,
    setting: SettingPref,
    practicalHandsOn: z.boolean(),
  }),
  narrative: z.string(),
});
export type StudentProfile = z.infer<typeof StudentProfile>;

export const College = z.object({
  id: z.string(),
  name: z.string(),
  city: z.string(),
  state: z.string(),
  region: Region,
  satP25: z.number().nullable(),
  satP75: z.number().nullable(),
  admitRate: z.number(), // 0..1
  netPrice: z.number().nullable(),
  pctNeedMet: z.number().nullable(), // 0..1
  enrollment: z.number(),
  setting: CollegeSetting,
  climate: CollegeClimate,
  programStrengths: z.array(z.string()),
  tags: z.array(z.string()),
});
export type College = z.infer<typeof College>;

export const ScoredCollege = z.object({
  college: College,
  fitScore: z.number(), // 0..100 weighted fit
  admitChance: z.number(), // 0..1 estimated acceptance likelihood
  rationale: z.string(),
});
export type ScoredCollege = z.infer<typeof ScoredCollege>;

/** A single list of colleges, ranked most-likely-to-be-admitted first. */
export const CollegeList = z.object({
  studentName: z.string(),
  assumptions: z.array(z.string()),
  colleges: z.array(ScoredCollege),
});
export type CollegeList = z.infer<typeof CollegeList>;

// --- Conversation (client-held; sent to /api/chat each turn) -----------------
export const ChatMessage = z.object({
  role: ChatRole,
  content: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

// --- API contracts (/api/chat request + response) ----------------------------
/**
 * Request body for `POST /api/chat`. The client holds the whole conversation
 * (`messages`) and the running `profile`, and re-sends them every turn (the
 * server is stateless).
 */
export const ChatRequest = z.object({
  messages: z.array(ChatMessage),
  profile: StudentProfile.nullable(),
});
export type ChatRequest = z.infer<typeof ChatRequest>;

/**
 * Response body for `POST /api/chat`. `studentName` is the detected name (from
 * the counselor's raw text) returned to the client for the PDF header — the raw
 * name itself never leaves the route.
 */
export interface ChatResponse {
  reply: string;
  action: ChatAction;
  profile: StudentProfile;
  list: CollegeList | null;
  studentName: string | null; // detected name, for the client's PDF header
}

/** A fully-empty profile: all nullable fields null, arrays empty, sensible defaults. */
export function emptyProfile(): StudentProfile {
  return {
    name: null,
    gpa: null,
    sat: null,
    act: null,
    apScores: [],
    interests: [],
    constraints: {
      homeState: null,
      maxDistance: null,
      climate: ClimatePref.enum.none,
      needsFinancialAid: false,
      size: SizePref.enum.none,
      setting: SettingPref.enum.none,
      practicalHandsOn: false,
    },
    narrative: "",
  };
}
