# College List Builder — Implementation Plan

> **Update — output model revised after this plan.** The tiered Reach/Target/Safety
> structure was replaced by a **single list ranked by admission chance**, and the
> clarifying-question path was removed (the router always builds a best-effort list). The
> task breakdown below is otherwise the record as built; see
> [`../../architecture.md`](../../architecture.md) for the current behavior.

**Goal:** Ship a Next.js app where a counselor describes a student in free-form text and
gets a college list ranked by admission chance, refined via chat, exportable as a PDF.

**Architecture:** One Next.js (App Router) + TypeScript app on Vercel. A per-turn
pipeline — de-identify → LLM router/extract → deterministic matching engine over a
~200-school public-data JSON → LLM curation (streamed rationales) → PDF. Conversation
state lives on the client; the server is stateless. The LLM provider is a config value
(default Google Gemini) behind one interface.

**Tech Stack:** Next.js 15 · TypeScript (strict) · Vercel AI SDK (`ai`, `@ai-sdk/google`)
· Zod · `@react-pdf/renderer` · Vitest · Tailwind. Deployed on Vercel.

Reference: [design spec](../2026-07-24-college-list-builder-design.md) ·
[architecture](../architecture.md).

## PR scope

**One task = one small PR** on its own branch (`feat/<task>`), against `main`. Keep PRs
small — a reviewer should read one in a few minutes; never bundle tasks. Split large
tasks (see the "split if large" notes on Tasks 4 and 12).

## Global Constraints

- **TypeScript `strict: true`**; all `lib/` modules are framework-free and unit-tested.
- **Gate (green before any task is done):** `npm run build` · `npm run lint` ·
  `npm run typecheck` · `npm test`. `npm run eval` / `npm run bench` are separate (live LLM).
- **LLM default:** `LLM_PROVIDER=google`, `LLM_MODEL=gemini-2.5-flash`. Provider is a
  config value; never hardcode a model in a module.
- **Secrets** server-side only; `.env*` gitignored (`.env.example` tracked).
- **Data:** public (College Scorecard) + synthetic only. No real student PII persisted;
  de-identify counselor input before it reaches the LLM.
- **Commits:** small, one logical change; reviewed before commit; each tagged.

## File structure

```
src/
  lib/
    types.ts          StudentProfile, College, CollegeList, Chat*, Trace* + Zod schemas
    config.ts         env-driven config (provider, model, tier counts, flags)
    pricing.ts        model → {input_per_1m, output_per_1m}; costOf(usage, model)
    llm.ts            LLMProvider interface + Vercel-AI-SDK impl, wrapped w/ instrumentation
    observability.ts  RequestTrace recorder + in-memory ring buffer (local only)
    deidentify.ts     maskPII(text) → { masked, name }
    dataset.ts        load + validate colleges.json
    matching.ts       pure: (profile, colleges) → CollegeList (tiers + scores)
    router.ts         LLM turn: (messages, profile) → { profile, action, reply }
    curate.ts         LLM: rank tiers + write rationale (constrained to matched schools)
    pdf.tsx           CollegeList → react-pdf document
  app/
    page.tsx          split view: chat panel + live list panel + Download PDF
    api/chat/route.ts orchestrate deidentify → router → matching → curate (stream)
    api/pdf/route.ts  validate school ids → render PDF
    admin/traces/page.tsx   local-only trace viewer (gated by ENABLE_TRACES)
  components/         ChatPanel, ListPanel, TierSection, SchoolCard, EmptyState
  data/colleges.json ~200 schools (generated)
scripts/
  build-dataset.ts    generate colleges.json from College Scorecard API
evals/                synthetic students + invariant assertions
bench/                latency / cost / provider-comparison
```

---

### Task 1: Scaffold + deploy skeleton live

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `.eslintrc.json`,
  `vitest.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `src/app/layout.tsx`,
  `src/app/page.tsx`, `src/app/globals.css`
- Create: `.env.example` (already present — verify)

**Produces:** a deployable Next.js app; `npm run dev` serves a placeholder home page.

- [ ] **Step 1: Scaffold.** `npx create-next-app@latest . --typescript --tailwind --app --eslint --src-dir --use-npm --no-import-alias` into the repo (it must accept the existing `.git`/`README`; if it refuses, scaffold in a temp dir and copy `src/`, configs).
- [ ] **Step 2: Add scripts** to `package.json`:
  ```json
  "scripts": {
    "dev": "next dev", "build": "next build", "start": "next start",
    "lint": "next lint", "typecheck": "tsc --noEmit",
    "test": "vitest run", "eval": "vitest run --dir evals",
    "bench": "vitest run --dir bench"
  }
  ```
- [ ] **Step 3: Install deps.** `npm i ai @ai-sdk/google @ai-sdk/anthropic zod @react-pdf/renderer` and `npm i -D vitest @types/node`.
- [ ] **Step 4: Set `strict: true`** in `tsconfig.json` (and `"noUncheckedIndexedAccess": true`).
- [ ] **Step 5: Placeholder page** — `src/app/page.tsx` returns a titled hero ("College List Builder"). Run `npm run build` → passes.
- [ ] **Step 6: Deploy skeleton.** `vercel` (or connect the GitHub repo in the Vercel dashboard). Confirm the URL loads. Add `GOOGLE_GENERATIVE_AI_API_KEY` env var in Vercel.
- [ ] **Step 7: Commit** — `chore: scaffold Next.js app + deploy skeleton`, tag `v0.3-scaffold`.

**Gate:** `npm run build && npm run lint && npm run typecheck && npm test` (no tests yet → vitest passes with "no tests"). Deployed URL loads.

---

### Task 2: Types + Zod schemas

**Files:**
- Create: `src/lib/types.ts`, `src/lib/types.test.ts`

**Interfaces — Produces (used by every later task):**
```ts
export const Tier = z.enum(["reach", "target", "safety"]);
export type Tier = z.infer<typeof Tier>;

export const StudentProfile = z.object({
  name: z.string().nullable(),
  gpa: z.number().min(0).max(4).nullable(),
  sat: z.number().min(400).max(1600).nullable(),
  act: z.number().min(1).max(36).nullable(),
  apScores: z.array(z.object({ subject: z.string(), score: z.number().min(1).max(5) })),
  interests: z.array(z.string()),
  constraints: z.object({
    homeState: z.string().nullable(),
    maxDistance: z.enum(["close", "regional", "anywhere"]).nullable(),
    climate: z.enum(["warm", "cold", "none"]),
    needsFinancialAid: z.boolean(),
    size: z.enum(["small", "medium", "large", "none"]),
    setting: z.enum(["urban", "suburban", "rural", "none"]),
    practicalHandsOn: z.boolean(),
  }),
  narrative: z.string(),
});
export type StudentProfile = z.infer<typeof StudentProfile>;

export const College = z.object({
  id: z.string(), name: z.string(), city: z.string(), state: z.string(),
  region: z.enum(["northeast", "midwest", "south", "west"]),
  satP25: z.number().nullable(), satP75: z.number().nullable(),
  admitRate: z.number(),           // 0..1
  netPrice: z.number().nullable(), pctNeedMet: z.number().nullable(),  // 0..1
  enrollment: z.number(),
  setting: z.enum(["urban", "suburban", "rural"]),
  climate: z.enum(["warm", "cold"]),
  programStrengths: z.array(z.string()),
  tags: z.array(z.string()),
});
export type College = z.infer<typeof College>;

export const ScoredCollege = z.object({
  college: College, fitScore: z.number(), tier: Tier, rationale: z.string(),
});
export type ScoredCollege = z.infer<typeof ScoredCollege>;

export const CollegeList = z.object({
  studentName: z.string(),
  assumptions: z.array(z.string()),
  reach: z.array(ScoredCollege), target: z.array(ScoredCollege), safety: z.array(ScoredCollege),
});
export type CollegeList = z.infer<typeof CollegeList>;

export type ChatMessage = { role: "counselor" | "assistant"; content: string };
export type ChatAction = "ask" | "list" | "refuse";
export const emptyProfile: () => StudentProfile;  // all-nulls/empties helper
```

- [ ] **Step 1: Failing test** (`types.test.ts`): `StudentProfile.parse(emptyProfile())` succeeds; a bad `sat` (2000) throws; `emptyProfile()` has `constraints.needsFinancialAid === false`.
- [ ] **Step 2:** Run → fails (module missing).
- [ ] **Step 3:** Implement `types.ts` with the schemas above + `emptyProfile()`.
- [ ] **Step 4:** Run → passes.
- [ ] **Step 5: Commit** — `feat: add core types and Zod schemas`, tag `v0.4-types`.

---

### Task 3: Config + pricing

**Files:**
- Create: `src/lib/config.ts`, `src/lib/pricing.ts`, `src/lib/config.test.ts`, `src/lib/pricing.test.ts`

**Interfaces — Produces:**
```ts
// config.ts
export type LlmConfig = { provider: "google" | "anthropic" | "openai"; model: string };
export function getLlmConfig(env?: NodeJS.ProcessEnv): LlmConfig; // reads LLM_PROVIDER/LLM_MODEL, defaults google/gemini-2.5-flash; throws if key missing
export const tierTargets = { perTier: 4, min: 2 };
export const limits = { maxInputChars: 4000, maxHistoryTurns: 12, maxOutputTokens: 1024 };
// pricing.ts
export type Usage = { inputTokens: number; outputTokens: number };
export function costOf(usage: Usage, model: string): number;  // USD
```

- [ ] **Step 1: Failing tests.** `config.test.ts`: `getLlmConfig({})` returns `{provider:"google", model:"gemini-2.5-flash"}`; `getLlmConfig({LLM_PROVIDER:"anthropic", LLM_MODEL:"claude-sonnet-5"})` returns that. `pricing.test.ts`: `costOf({inputTokens:1_000_000, outputTokens:0}, "gemini-2.5-flash")` equals the table's input_per_1m; unknown model falls back to a default rate (not NaN).
- [ ] **Step 2:** Run → fails.
- [ ] **Step 3:** Implement. `pricing.ts` holds `PRICING: Record<string, {input_per_1m, output_per_1m}>` for `gemini-2.5-flash`, `claude-sonnet-5`, with a default. `costOf = (u,m) => (u.inputTokens*p.input_per_1m + u.outputTokens*p.output_per_1m)/1e6`.
- [ ] **Step 4:** Run → passes.
- [ ] **Step 5: Commit** — `feat: add env-driven LLM config and pricing table`, tag `v0.5-config`.

---

### Task 4: Dataset build script + loader

> **Split if large:** (4a) `dataset.ts` loader + `types`-validated `colleges.json` (a small
> hand-seeded ~30-school sample is fine to unblock downstream tasks); (4b) the full
> `scripts/build-dataset.ts` generation to ~200 schools. Downstream tasks only need the loader.

**Files:**
- Create: `scripts/build-dataset.ts`, `src/data/colleges.json`, `src/lib/dataset.ts`, `src/lib/dataset.test.ts`

**Interfaces — Produces:** `export function loadColleges(): College[];` (imports + validates the JSON at module load).

- [ ] **Step 1:** Write `scripts/build-dataset.ts` — fetch College Scorecard API
  (`https://api.data.gov/ed/collegescorecard/v1/schools`, free `DATA_GOV_API_KEY` or `DEMO_KEY`),
  pulling fields: name, city, state, `latest.admissions.sat_scores.25th/75th_percentile`,
  `latest.admissions.admission_rate.overall`, `latest.cost.avgnetprice.overall`,
  `latest.aid.pell_grant_rate`/net-price, `latest.student.size`, locale. Curate ~200 across
  regions × selectivity bands. Derive `region`/`climate` from state (a lookup map), `setting`
  from locale, `programStrengths`/`tags` from CIP program shares (map top programs → labels).
  Write `src/data/colleges.json` validated with `z.array(College)`.
- [ ] **Step 2:** Run `npx tsx scripts/build-dataset.ts` → produces a ~200-entry JSON that
  `z.array(College).parse` accepts. (If the API is flaky, cache the raw pages locally and
  transform offline; commit only the derived JSON, not raw dumps.)
- [ ] **Step 3: Failing test** (`dataset.test.ts`): `loadColleges().length >= 150`; every
  record parses `College`; at least one school in each `region`; admit rates within `0..1`.
- [ ] **Step 4:** Implement `dataset.ts`: `import data from "../data/colleges.json"; export const loadColleges = () => z.array(College).parse(data);` (memoize).
- [ ] **Step 5:** Run → passes.
- [ ] **Step 6: Commit** — `feat: add college dataset build script and loader`, tag `v0.6-dataset`.

---

### Task 5: De-identification

**Files:**
- Create: `src/lib/deidentify.ts`, `src/lib/deidentify.test.ts`

**Interfaces — Produces:** `export function maskPII(text: string): { masked: string; name: string | null };`
(replaces a detected person-name with `«STUDENT»`; strips emails/phones/street addresses.)

- [ ] **Step 1: Failing tests.** Input `"I have a student named John Smith, 1230 SAT"` →
  `name === "John Smith"`, `masked` contains `«STUDENT»` and not `"John Smith"`, and still
  contains `"1230 SAT"`. Email `"a@b.com"` and phone `"215-555-1234"` are removed. A prompt
  with no name → `name === null`, `masked === input` (minus any email/phone). "named" cue and
  capitalized-bigram fallback both detected.
- [ ] **Step 2:** Run → fails.
- [ ] **Step 3:** Implement with regexes: name via cues (`/\bnamed?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/`, `/\bstudent\s+([A-Z][a-z]+\s+[A-Z][a-z]+)/`) then a capitalized-bigram fallback that skips a small stopword set (state names, months, "SAT"/"AP"). Email/phone/street regexes. Return first name found + fully-masked text.
- [ ] **Step 4:** Run → passes.
- [ ] **Step 5: Commit** — `feat: add PII de-identification at the route edge`, tag `v0.7-deid`.

---

### Task 6: Matching engine (the deterministic core — TDD)

**Files:**
- Create: `src/lib/matching.ts`, `src/lib/matching.test.ts`

**Interfaces — Consumes:** `StudentProfile`, `College[]`. **Produces:**
```ts
export function classifyTier(profile: StudentProfile, c: College): Tier;
export function fitScore(profile: StudentProfile, c: College): number;   // 0..100
export function buildList(profile: StudentProfile, colleges: College[]): CollegeList;
// buildList: classify each → score within tier → take up to tierTargets.perTier per tier
// (flex down to tierTargets.min), rationale left "" (curate fills it).
```

Tier rule (encode exactly):
- SAT-equivalent = `profile.sat ?? actToSat(profile.act) ?? null`.
- **Selectivity floor:** `admitRate < 0.15` ⇒ **reach** (regardless of stats).
- Else if SAT-equiv known: below `satP25` or below median ⇒ reach; within `p25..p75` ⇒ target;
  above `p75` **and** `admitRate >= 0.40` ⇒ safety; above `p75` but `admitRate < 0.40` ⇒ target.
- If SAT-equiv unknown: tier on admit-rate bands (`<0.15` reach, `0.15..0.5` target, `>=0.5` safety);
  push `"Assumed admissibility from admit rate (no test scores provided)"` into assumptions.

Fit score (weighted 0..100): program match (interests ↔ programStrengths/tags overlap, highest
weight) + constraint satisfaction (climate, distance via region/homeState, size, setting) +
financial-aid bonus (high `pctNeedMet`/low `netPrice` when `needsFinancialAid`) + small
"widen" boost for lower-profile strong fits (e.g. `admitRate > 0.3`).

- [ ] **Step 1: Failing tests** (write these first):
  ```ts
  const p1230 = { ...emptyProfile(), sat: 1230, interests: ["computer science"] };
  test("1560 student never gets a <15% school as safety", () => {
    const list = buildList({ ...emptyProfile(), sat: 1560 }, loadColleges());
    for (const s of list.safety) expect(s.college.admitRate).toBeGreaterThanOrEqual(0.15);
  });
  test("tier respects range and admit rate", () => {
    const mit = { ...C, satP25: 1500, satP75: 1570, admitRate: 0.04 };
    expect(classifyTier({ ...emptyProfile(), sat: 1560 }, mit)).toBe("reach"); // floor wins
  });
  test("aid student skews to high pctNeedMet / low netPrice", () => {
    const list = buildList({ ...emptyProfile(), constraints: { ...c, needsFinancialAid: true } }, colleges);
    const all = [...list.reach, ...list.target, ...list.safety];
    expect(avg(all.map(s => s.college.pctNeedMet ?? 0))).toBeGreaterThan(datasetAvgPctNeedMet);
  });
  test("no school appears twice / in two tiers", () => { /* ids unique across tiers */ });
  test("missing SAT/GPA degrades and records an assumption", () => { /* assumptions non-empty */ });
  test("tiers flex down not pad: thin interest pool yields <perTier but >=min", () => {});
  ```
- [ ] **Step 2:** Run → all fail.
- [ ] **Step 3:** Implement `matching.ts` per the rules above.
- [ ] **Step 4:** Run → all pass.
- [ ] **Step 5: Commit** — `feat: add deterministic matching engine`, tag `v0.8-matching`.

---

### Task 7: LLM provider (instrumented) + observability

**Files:**
- Create: `src/lib/observability.ts`, `src/lib/llm.ts`, `src/lib/observability.test.ts`, `src/lib/llm.test.ts`

**Interfaces — Produces:**
```ts
// observability.ts
export type InvocationRecord = { step: "router"|"curate"|"embed"; model: string;
  inputTokens: number; outputTokens: number; costUSD: number; durationMs: number };
export type RequestTrace = { id: string; ts: string; action: ChatAction;
  steps: (InvocationRecord | { step: "match"; durationMs: number; scored: number })[];
  totalTokens: number; totalCostUSD: number };
export function recordTrace(t: RequestTrace): void;   // push to ring buffer (cap 50)
export function recentTraces(): RequestTrace[];
// llm.ts
export interface LLMProvider {
  generateObject<T>(o: { schema: z.ZodType<T>; prompt: string; system?: string }): Promise<{ value: T; usage: Usage }>;
  generateText(o: { prompt: string; system?: string }): Promise<{ text: string; usage: Usage }>;
  streamText(o: { prompt: string; system?: string }): AsyncIterable<string> & { usage: Promise<Usage> };
}
export function getProvider(cfg?: LlmConfig): LLMProvider;   // Vercel AI SDK impl
```

- [ ] **Step 1: Failing tests.** `observability.test.ts`: `recordTrace` keeps only the last 50; `recentTraces()` returns newest-first. `llm.test.ts`: `getProvider` returns an object exposing `generateObject`/`generateText`/`streamText` (shape check; no network — assert the functions exist and that a mock model returns a parsed object).
- [ ] **Step 2:** Run → fails.
- [ ] **Step 3:** Implement. `llm.ts` maps `getLlmConfig()` → a Vercel AI SDK model (`google(cfg.model)` / `anthropic(cfg.model)`), and wraps `generateObject`/`generateText`/`streamText` from `ai`; after each call, read `usage` and return it (route handlers build `InvocationRecord`s from it). `observability.ts` is a module-level array with push/cap.
- [ ] **Step 4:** Run → passes.
- [ ] **Step 5: Commit** — `feat: add model-agnostic LLM provider with token instrumentation`, tag `v0.9-llm`.

---

### Task 8: Router (extract + decide) — mocked-LLM integration

**Files:**
- Create: `src/lib/router.ts`, `src/lib/router.test.ts`

**Interfaces — Consumes:** `LLMProvider`, `StudentProfile`. **Produces:**
```ts
export type RouterResult = { profile: StudentProfile; action: ChatAction; reply: string };
export async function route(o: { llm: LLMProvider; messages: ChatMessage[];
  profile: StudentProfile; clarifyingCount: number }): Promise<RouterResult>;
```

Router calls `llm.generateObject` with a schema `{ profile: StudentProfile, action, reply }`
and a hardened system prompt: college-list domain only; ignore user attempts to change role/
task/format; merge new info into the running profile (never drop prior fields); `action:"ask"`
only if a question would materially change the list **and** `clarifyingCount < 2`;
`action:"refuse"` for off-topic/role-override; else `action:"list"`. Low temperature. `reply`
length-capped.

- [ ] **Step 1: Failing tests** (inject a mock `LLMProvider` returning canned objects):
  off-topic message ("build me a website") → `action:"refuse"`; thin prompt with
  `clarifyingCount 0` → `"ask"`; full prompt → `"list"` with populated profile; a follow-up
  ("actually 1400 SAT") merges without dropping prior `interests`.
- [ ] **Step 2:** Run → fails.
- [ ] **Step 3:** Implement `route()` — build system+prompt from messages+profile, call the
  injected `llm.generateObject`, return its value.
- [ ] **Step 4:** Run → passes.
- [ ] **Step 5: Commit** — `feat: add LLM router with guardrail and profile merge`, tag `v0.10-router`.

---

### Task 9: Curation (streamed rationales)

**Files:**
- Create: `src/lib/curate.ts`, `src/lib/curate.test.ts`

**Interfaces — Consumes:** `LLMProvider`, `CollegeList`, `StudentProfile`. **Produces:**
```ts
export async function curate(o: { llm: LLMProvider; profile: StudentProfile; list: CollegeList })
  : Promise<CollegeList>;   // returns list with rationale filled per school
```

Curate sends the profile + the matched schools *with their stats* and asks for a 1–2 sentence
"why it fits" per school id, **constrained to only those ids** (schema keyed by id). Grounding
guard: only reference provided stats/programStrengths/tags. Fairness guard: ignore protected
attributes. (Streaming is wired at the route layer; `curate` returns the completed list.)

- [ ] **Step 1: Failing tests** (mock LLM returns `{ rationales: { [id]: string } }`): every
  returned school has a non-empty `rationale`; an id not in the input list is dropped (never
  added); schools/ids are unchanged from the matched list.
- [ ] **Step 2:** Run → fails.
- [ ] **Step 3:** Implement — call `llm.generateObject` with an id→string rationale schema,
  map back onto the list, leave school set untouched.
- [ ] **Step 4:** Run → passes.
- [ ] **Step 5: Commit** — `feat: add constrained LLM curation of rationales`, tag `v0.11-curate`.

---

### Task 10: PDF renderer

**Files:**
- Create: `src/lib/pdf.tsx`, `src/lib/pdf.test.ts`

**Interfaces — Produces:** `export function CollegeListPdf(props: { list: CollegeList }): JSX.Element;`
and `export async function renderListToBuffer(list: CollegeList): Promise<Buffer>;`

Layout: header (student name + date) → Reach/Target/Safety sections → each school: name,
location, SAT range, admit rate, est. net price, rationale → footer disclaimer
("Data-informed suggestions from public data (U.S. DOE College Scorecard) — not a guarantee
of admission or aid.") + assumptions listed up top.

- [ ] **Step 1: Failing test.** `renderListToBuffer(sampleList)` resolves to a non-empty
  `Buffer` starting with `%PDF`.
- [ ] **Step 2:** Run → fails.
- [ ] **Step 3:** Implement with `@react-pdf/renderer` (`Document/Page/View/Text`,
  `renderToBuffer`). Pure JS — no Chromium.
- [ ] **Step 4:** Run → passes.
- [ ] **Step 5: Commit** — `feat: add react-pdf college-list renderer`, tag `v0.12-pdf`.

---

### Task 11: `/api/chat` + `/api/pdf` routes

**Files:**
- Create: `src/app/api/chat/route.ts`, `src/app/api/pdf/route.ts`, `src/app/api/chat/route.test.ts`

**Interfaces — Consumes:** everything above. `/api/chat` accepts
`{ messages, profile, list, clarifyingCount }` (Zod-validated), runs: `maskPII` (raw text never
logged; name returned to client separately) → `route()` → if `"list"`: `buildList` →
`curate` → build+`recordTrace` → respond `{ reply, action, profile, list, clarifyingCount, studentName }`;
if `"ask"`/`"refuse"`: respond with `reply` and updated profile, no matching. Enforce
`limits.maxInputChars` and last-N-turns cap; wrap LLM calls in one retry + timeout.
`/api/pdf` accepts a `CollegeList`, **rejects any school id not in `loadColleges()`**, returns
the PDF stream.

- [ ] **Step 1: Failing tests** (mock `getProvider`): POST a full prompt → 200 with
  `action:"list"` and a non-empty tiered list; POST "write me a poem" → `action:"refuse"`, no
  list; POST oversized input → 400; `/api/pdf` with a fabricated school id → 400.
- [ ] **Step 2:** Run → fails.
- [ ] **Step 3:** Implement both routes (App Router `route.ts`, `export async function POST`).
  Stream the curate rationales via the AI SDK where practical; the deterministic list is sent
  first so the client renders immediately.
- [ ] **Step 4:** Run → passes.
- [ ] **Step 5: Commit** — `feat: add chat and pdf API routes`, tag `v0.13-api`.

---

### Task 12: Frontend — split view, refine loop, empty state, responsive

> **Split if large:** land it as up to three small PRs — (12a) `ListPanel`/`TierSection`/
> `SchoolCard` rendering a static list; (12b) `ChatPanel` + the `/api/chat` refine loop;
> (12c) `EmptyState` examples + PDF download + responsive polish. Each is independently
> reviewable and testable.

**Files:**
- Create: `src/app/page.tsx` (replace placeholder), `src/components/ChatPanel.tsx`,
  `ListPanel.tsx`, `TierSection.tsx`, `SchoolCard.tsx`, `EmptyState.tsx`,
  `src/components/page.test.tsx` (light)

**Interfaces — Consumes:** `/api/chat`, `/api/pdf`. Client holds `{ messages, profile, list,
clarifyingCount, studentName }` in React state; each turn POSTs them and merges the response.

- [ ] **Step 1: Failing test** (Vitest + Testing Library, mock `fetch`): submitting a message
  renders the assistant reply and, on an `action:"list"` response, renders tier sections with
  school cards; the Download button is disabled until a list exists.
- [ ] **Step 2:** Run → fails.
- [ ] **Step 3:** Implement. Split view (`grid md:grid-cols-2`, stacks below `md`). Chat left
  (textarea + transcript, streamed reply). List right renders immediately from `list`;
  rationales fill as they stream. `EmptyState` shows 2–3 clickable example prompts (original
  synthetic students). Download PDF POSTs the current list, opens the blob.
- [ ] **Step 4:** Run → passes; `npm run dev` shows the full flow against a real key.
- [ ] **Step 5: Commit** — `feat: add split-view chat UI with live list and PDF download`, tag `v0.14-ui`.

**◆ MVP-DONE LINE — after Task 12 the product is complete, working, and deployed.** Redeploy
and verify end-to-end. Everything below is a documented, cuttable enhancement.

---

### Task 13: Correctness + fairness + guardrail evals

**Files:** Create `evals/pipeline.eval.test.ts`, `evals/students.ts` (~10–15 synthetic students).

- [ ] **Step 1:** Write invariant assertions over `buildList` (+ a mockable pipeline): every list
  has ≥1 reach and ≥1 safety; no duplicate schools/tiers; tier consistent with range **and**
  admit rate; aid students skew high-`pctNeedMet`/low-`netPrice`; no out-of-dataset school;
  **fairness** — two students identical but for a protected-attribute mention get the same list;
  **guardrail** — off-topic/role-override → `refuse`, no matching.
- [ ] **Step 2:** Run `npm run eval` → passes (these run deterministic `buildList` + mocked LLM;
  the live-LLM subset is opt-in behind a key check).
- [ ] **Step 3: Commit** — `test: add correctness, fairness, and guardrail evals`, tag `v0.15-evals`.

---

### Task 14: Observability wiring + `/admin/traces` + security hardening

**Files:** Create `src/app/admin/traces/page.tsx`; edit routes to `recordTrace` + caps/rate-limit.

- [ ] **Step 1:** Wire `recordTrace` into `/api/chat` with per-step `InvocationRecord`s
  (tokens/cost from `usage`, latency via `performance.now()`), PII-free.
- [ ] **Step 2:** `/admin/traces` — a dev-only page reading `recentTraces()`, rendered only when
  `process.env.ENABLE_TRACES` is set (return 404 otherwise). Table of turns → expandable step
  timeline + token/cost totals.
- [ ] **Step 3:** Hardening — Zod validation already at the route boundary; add input length cap,
  per-call timeout+abort, and best-effort rate limiting (Upstash if `UPSTASH_*` set, else
  in-instance). Optional daily request kill-switch.
- [ ] **Step 4:** `npm run build && npm test` green; locally set `ENABLE_TRACES=1` and confirm the
  viewer; confirm it 404s without the flag.
- [ ] **Step 5: Commit** — `feat: add local trace viewer and security hardening`, tag `v0.16-observability`.

---

### Task 15: Benchmarks

**Files:** Create `bench/latency.bench.test.ts`, `bench/matching.bench.test.ts`, `bench/providers.bench.test.ts`.

- [ ] **Step 1:** Engine micro-bench — ms to `buildList` over the full dataset (assert sub-few-ms).
- [ ] **Step 2:** Latency + cost — time-to-first-list vs full-turn; cost/tokens per list from the
  `RequestTrace` (real key required; skip gracefully if absent).
- [ ] **Step 3:** Provider comparison — run N synthetic students across `google`/`anthropic`
  (and Groq if configured) → a latency × cost × quality table; write results to `bench/results.md`.
- [ ] **Step 4:** `npm run bench` produces the table (key-gated).
- [ ] **Step 5: Commit** — `test: add latency, cost, and provider-comparison benchmarks`, tag `v0.17-bench`.

---

### Task 16: README, Decision Log, final deploy

**Files:** Edit `README.md`; create `docs/decisions.md`.

- [ ] **Step 1:** `docs/decisions.md` — one ADR-style entry per architecture call (engine choice,
  tiers, model-agnostic layer, de-id location, react-pdf over Puppeteer, excluded infra, trace
  buffer), each stating the tradeoff (speed vs reliability/security/scale).
- [ ] **Step 2:** README — fill the live demo URL + a screenshot/GIF; note what was and wasn't
  built (hours spent, cut items) per the honesty rule.
- [ ] **Step 3:** Final Vercel deploy; verify the full flow on the live URL; run the gate.
- [ ] **Step 4: Commit** — `docs: add README polish and decision log`, tag `v1.0`.

---

## Self-review (spec coverage)

- Engine A (extract→match→curate) → Tasks 6/8/9/11 ✓
- Reach/Target/Safety + selectivity floor → Task 6 ✓
- Chat refine loop + streamed instant list + empty state + responsive → Tasks 11/12 ✓
- Model-agnostic (Gemini default, config swap) → Tasks 3/7 ✓
- De-identification at route edge → Tasks 5/11 ✓
- Guardrail (refuse) + prompt hardening → Task 8 ✓
- Fairness + rationale grounding → Tasks 6/9/13 ✓
- Token/cost tracking + local trace viewer → Tasks 7/14 ✓
- Security hardening (caps, rate limit, validation, secrets) → Tasks 11/14 ✓
- PDF (+ dataset-id validation, disclaimer) → Tasks 10/11 ✓
- Evals + benchmarks (separate from the commit gate) → Tasks 13/15 ✓
- Vector search (stretch) → intentionally deferred; §6 of the spec has the self-contained plan.
- Excluded infra (Mongo/Redis/S3/Express) → not built, documented in `docs/decisions.md` (Task 16).
