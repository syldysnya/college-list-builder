# College List Builder

Turn a counselor's free-form description of a student into a **data-informed college
list** — a single list **ranked by admission chance**, exportable as a PDF.

A counselor describes a student in plain language:

> *"Hardworking first-gen student, set on environmental engineering — strong GPA,
> test scores still coming together. Needs real financial aid and would thrive with a
> tight-knit campus community."*

…and the app extracts a structured profile, matches it against a dataset of colleges
built from public U.S. Department of Education data, and returns a list ranked
most-likely-admitted-first with a short, tailored rationale for each school. It never
stalls on clarifying questions — a thin description still yields a best-effort list, with
a note on what would sharpen it. Keep refining in the chat ("more warm-weather options",
"she also plays violin"); download any answer to PDF.

## Highlights

- **Data-driven, not guesswork** — every school comes from a real public dataset; the
  model curates and explains, but never invents colleges or their stats.
- **Semantic program matching** — a student's interests match relevant college
  programs even when the words differ ("coding" → *Computer Science*, "pre-med" →
  *Biology*), via embeddings blended into the deterministic fit score. Exact matches
  always still count; semantic only adds recall, and the ranking stays reproducible.
- **Ranked by admission chance** — each school's acceptance likelihood is computed from
  *this* student's academics versus its admitted range and admit rate, and the list is
  ordered most-likely-first.
- **Answers in the chat** — the college list renders inline in the assistant's answer as
  formatted markdown, with per-school source links and a Download-PDF button; a thin
  description still produces a best-effort list (never a clarifying-question dead end).
- **Model-agnostic** — Google Gemini by default; switch to Anthropic Claude or OpenAI
  with a single environment variable, no code changes.
- **Privacy-first** — student PII is de-identified before anything reaches the model.

## How it works

```
description → de-identify → extract profile (LLM) → embed interests
           → match dataset (deterministic; keyword + semantic) → curate rationale (LLM)
           → ranked list → PDF
```

The list quality comes from a **deterministic matching engine** over real data; the LLM
is used only for the two things it's genuinely good at — reading messy prose into a
structured profile, and writing tailored explanations. See
[`docs/architecture.md`](docs/architecture.md) for diagrams and the reasoning behind
each decision.

## Tech stack

Next.js (App Router) · TypeScript · [Vercel AI SDK](https://sdk.vercel.ai) ·
`@react-pdf/renderer` · Vitest · deployed on Vercel.

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in a provider API key
npm run dev                  # http://localhost:3000
```

### Environment

| Variable | Default | Notes |
|---|---|---|
| `LLM_PROVIDER` | `google` | `google` · `anthropic` · `openai` |
| `LLM_MODEL` | `gemini-2.5-flash` | any model id valid for the provider |
| `GOOGLE_GENERATIVE_AI_API_KEY` | — | free tier via [Google AI Studio](https://aistudio.google.com) |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | — | only if you switch provider |
| `ENABLE_TRACES` | unset | set locally to enable the `/admin/traces` viewer |

### Scripts

```bash
npm run build       # production build
npm run lint        # eslint
npm run typecheck   # tsc --noEmit
npm test            # vitest — unit + integration (mocked; no API key needed)
npm run eval        # pipeline evals through a live model (needs an API key)
npm run bench       # latency / cost / provider-comparison benchmarks
```

## Testing & evaluation

`npm test` runs fast, hermetic unit + integration tests (the model is mocked, so no API
key is needed) — this is the commit gate. `npm run eval` runs a small **eval harness**
that sends synthetic students through the full pipeline against a live model to assert
behavioral invariants (ranking reflects the student's odds, no duplicate or out-of-dataset
schools, advice is invariant to protected attributes). `npm run bench` tracks latency,
cost per list, and a provider comparison.

## Data & disclaimer

College data is derived from the public **U.S. Department of Education College
Scorecard**. Results are data-informed *suggestions*, not a guarantee of admission or
financial aid — always verify current figures with each college.

## License

MIT — see [LICENSE](LICENSE).
