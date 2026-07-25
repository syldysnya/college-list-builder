# College List Builder — Architecture

Three diagrams, each answering one question about how the system works. Full rationale
lives in [the design spec](design/2026-07-24-college-list-builder-design.md).

---

## 1. What happens when a counselor sends a message? (request flow + refine loop)

The app is a **conversation**, not a one-shot form. Each message runs a stateless
server pipeline; the browser holds the state and the list refines in place.

```mermaid
flowchart TD
    U([Counselor types a message]) --> C{{"Client state<br/>transcript · profile · list"}}
    C -->|"POST /api/chat"| D["0 · De-identify<br/>mask student PII"]
    D --> R["1 · Router + Extract · LLM<br/>merge into StudentProfile,<br/>decide build vs refuse"]
    R -->|"action = refuse"| Q["Off-topic redirect<br/>(guardrail)"]
    Q --> C
    R -->|"action = list (always)"| M["2 · Matching engine<br/>pure TS · deterministic<br/>build list + candidate pool"]
    M -->|"renders in the answer"| P["Ranked list<br/>guaranteed reach/target/safety spread,<br/>best-fit first"]
    M --> S["3 · Select · LLM<br/>re-rank grounded pool,<br/>ids validated against pool"]
    S -->|"picks"| CU["4 · Curate · LLM (streamed)<br/>'why it fits' per school<br/>(only matched schools)"]
    M -.->|"on select failure"| CU
    CU -->|"rationales stream in"| P
    P -->|"Download"| PDF["5 · PDF render<br/>@react-pdf/renderer"]

    C -.refine.-> U

    classDef llm fill:#e8dcff,stroke:#7c4dff,color:#1a1a1a;
    classDef pure fill:#d7f5e0,stroke:#22a06b,color:#1a1a1a;
    class R,S,CU llm;
    class M,D pure;
```

**Notes:** the LLM does three things it's good at — reading messy prose into
structured data (router), re-ranking a grounded candidate pool with knowledge the
dataset doesn't carry like co-op and hands-on learning (select), and writing tailored
prose (curate). Selection can never invent a school: the model returns ids, and only
ids present in the pool survive (`finalizeSelection`); any select failure falls back to
the deterministic list the matching engine already built. Before building the list, the
route embeds the student's interests (`gemini-embedding-001`, 256-dim) and loads the
committed college vectors; on any failure it falls back to keyword-only, logged as a
step.

---

## 2. How is the code organized? (components + dependencies)

One Next.js app on Vercel. All logic sits in framework-free `lib/` modules that thin API
routes call — which is why it's portable to Express and needs no separate backend.

```mermaid
flowchart LR
    subgraph Client["Browser — holds ALL state (no DB)"]
        UI["page.tsx<br/>chat · inline ranked list"]
    end

    subgraph Server["Vercel serverless — stateless"]
        CHAT["api/chat"]
        PDFAPI["api/pdf"]
        subgraph L["lib/ (framework-free, testable)"]
            DEID["deidentify"]
            ROUTER["router"]
            MATCH["matching<br/>(pure fn) · retrievePool"]
            SELECT["select<br/>selectColleges · finalizeSelection"]
            CURATE["curate"]
            LLM["llm<br/>Vercel AI SDK"]
            CFG["config"]
            PDFLIB["pdf"]
            EMB["embeddings<br/>cosine · calibrate · programDocument"]
            EMBPROV["embeddings-provider<br/>Google embedding seam"]
            EMBDATA["embeddings-data<br/>artifact loader (cached)"]
            SEM["semantic<br/>buildSemanticContext"]
        end
        DATA[("dataset.json<br/>~200 schools · public data")]
        VEC[("colleges.embeddings.json<br/>precomputed college vectors")]
    end

    SYNC["scripts/sync-embeddings.ts<br/>build-time generator"]

    PROV{{"Gemini (default)<br/>· Claude · OpenAI"}}
    GOOGLEEMB{{"Google gemini-embedding-001"}}

    UI -->|chat turn| CHAT
    UI -->|download| PDFAPI
    CHAT --> DEID --> ROUTER --> MATCH --> SELECT --> CURATE
    MATCH -.->|"fallback on select failure"| CURATE
    ROUTER --> LLM
    SELECT --> LLM
    CURATE --> LLM
    LLM --> CFG
    LLM -.provider by config.-> PROV
    MATCH --> DATA
    MATCH --> EMB
    CHAT --> SEM
    SEM --> EMBPROV
    SEM --> EMBDATA
    EMBPROV --> EMB
    EMBPROV -.always Google.-> GOOGLEEMB
    EMBDATA --> VEC
    SYNC -.build-time only.-> EMBPROV
    SYNC --> VEC
    PDFAPI --> PDFLIB
```

**Notes:** the LLM provider is a **config value** (`LLM_PROVIDER`/`LLM_MODEL`),
so switching Gemini→Claude is one env var. Embeddings are a separate, always-Google
seam (`gemini-embedding-001`) — `sync-embeddings.ts` precomputes college vectors at
build time into the committed `colleges.embeddings.json`, so the runtime only ever
calls the embedding API for the student's interests, and that call fails soft to
keyword-only. Deliberately *absent*: MongoDB, Redis, S3, Express, and a vector
database — a stateless prompt→list→PDF function doesn't need them, and ~1,500 ×
256-dim in-memory cosine is too small to warrant one.

---

## 3. How do we protect the student's identity? (privacy data-path)

The sensitive value (real name) and the useful value (a list) travel on **separate
paths** that only rejoin in the browser, at PDF render. The name is structurally unable
to reach the model.

```mermaid
flowchart LR
    MSG(["Counselor message<br/>(may contain a real name)"]) --> DEID{{"De-identify · route edge<br/>extract name + mask PII<br/>raw text never logged"}}
    DEID -->|"masked text «STUDENT»"| SRV["LLM · downstream · logs"]
    DEID -.->|"real name → browser only"| CS["Client state"]
    CS --> HDR["PDF header on download"]

    classDef danger fill:#ffe0e0,stroke:#e5484d,color:#1a1a1a;
    classDef safe fill:#d7f5e0,stroke:#22a06b,color:#1a1a1a;
    class SRV danger;
    class CS,HDR safe;
```

> The message is de-identified at the **route edge**: only masked text (`«STUDENT»`)
> flows to the LLM/logs, while the extracted real name is sent straight back to the
> browser for the PDF header. **Precise guarantee: the name never reaches the LLM or
> logs.** The edge transiently handles it *in order to mask it* — that's what makes
> masking possible; we don't overstate it as "never touches the server".

**Notes:** privacy-by-architecture, not by policy — real student PII stays out
of the model and logs even if a counselor pastes a real name.

---

## Key decisions at a glance

| Decision | Choice | Why |
|---|---|---|
| Generation engine | Extract → match dataset (deterministic) → LLM select (grounded) → LLM curate | Real data, not guesswork; no hallucinated schools |
| Grounded LLM selection | Model re-ranks a real candidate pool of dataset ids | Applies reputational knowledge (co-op, hands-on) the dataset lacks; ids validated against the pool so no invented schools; any failure falls back to the deterministic list |
| List structure | Single list, ~12 schools, ordered best-fit-first | Fit (not just admission odds) decides ordering; no arbitrary tier cutoffs |
| Selectivity spread over admit-chance sort | Bucket by admit chance into reach (<0.30) / target / safety (≥0.75); each bucket contributes its best-fit schools to a guaranteed 3/5/4 spread, backfilled to a full list | Guarantees a reach/target/safety mix instead of the twelve highest admit rates; geography is a heavily-weighted soft signal, not a hard filter; the chat reply never enumerates colleges — the cards are the list |
| Interaction | Chat-style refine loop; answers render inline | Iterative counseling; always answers, never a clarifying dead-end |
| LLM layer | Model-agnostic, **default Gemini** | Free tier → $0; provider is a one-line config swap |
| Privacy | De-identify before LLM | Keeps real student PII out of the model and logs |
| Semantic matching | Augments program-fit only | Embeddings only feed `programComponent` inside `fitScore`; admit-chance, prestige, and bucket selection stay deterministic |
| College vectors | Precomputed + committed | Runtime needs no key for the college side; results are reproducible |
| Vector storage | No vector DB | ~1,500 × 256-dim in-memory cosine is trivial; an index/DB is unwarranted |
| Excluded infra | No Mongo/Redis/S3/Express | Stateless function; adding them = cargo-culting |
| Host | Vercel | Free; zero-config for Next.js; one `git push` |
