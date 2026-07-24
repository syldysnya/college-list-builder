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
    D --> R["1 · Router + Extract · LLM<br/>merge into StudentProfile,<br/>decide ask vs build"]
    R -->|"action = ask"| Q["Clarifying question<br/>(≤ 2 per conversation)"]
    Q --> C
    R -->|"action = list"| M["2 · Matching engine<br/>pure TS · deterministic"]
    M -->|"list renders NOW<br/>(no LLM wait)"| P["Live list panel<br/>Reach / Target / Safety"]
    M --> CU["3 · Curate · LLM (streamed)<br/>'why it fits' per school<br/>(only matched schools)"]
    CU -->|"rationales stream in"| P
    P -->|"Download"| PDF["4 · PDF render<br/>@react-pdf/renderer"]

    C -.refine.-> U

    classDef llm fill:#e8dcff,stroke:#7c4dff,color:#1a1a1a;
    classDef pure fill:#d7f5e0,stroke:#22a06b,color:#1a1a1a;
    class R,CU llm;
    class M,D pure;
```

**Notes:** the LLM does the two things it's good at — reading messy prose into
structured data (router) and writing tailored prose (curate). The two steps that must be
*defensible* — which schools, which tier — are **pure deterministic code** (green) over
real data, so nothing is hallucinated. Because that step is instant, the list **renders
before curate runs** and the rationales stream in after — fast *and* correct.

---

## 2. How is the code organized? (components + dependencies)

One Next.js app on Vercel. All logic sits in framework-free `lib/` modules that thin API
routes call — which is why it's portable to Express and needs no separate backend.

```mermaid
flowchart LR
    subgraph Client["Browser — holds ALL state (no DB)"]
        UI["page.tsx<br/>split view: chat + live list"]
    end

    subgraph Server["Vercel serverless — stateless"]
        CHAT["api/chat"]
        PDFAPI["api/pdf"]
        subgraph L["lib/ (framework-free, testable)"]
            DEID["deidentify"]
            ROUTER["router"]
            MATCH["matching<br/>(pure fn)"]
            CURATE["curate"]
            LLM["llm<br/>Vercel AI SDK"]
            CFG["config"]
            PDFLIB["pdf"]
        end
        DATA[("dataset.json<br/>~200 schools · public data")]
    end

    PROV{{"Gemini (default)<br/>· Claude · OpenAI"}}

    UI -->|chat turn| CHAT
    UI -->|download| PDFAPI
    CHAT --> DEID --> ROUTER --> MATCH --> CURATE
    ROUTER --> LLM
    CURATE --> LLM
    LLM --> CFG
    LLM -.provider by config.-> PROV
    MATCH --> DATA
    PDFAPI --> PDFLIB
```

**Notes:** the LLM provider is a **config value** (`LLM_PROVIDER`/`LLM_MODEL`),
so switching Gemini→Claude is one env var. Deliberately *absent*: MongoDB, Redis, S3,
Express — a stateless prompt→list→PDF function doesn't need them.

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
| Generation engine | Extract → match dataset → LLM curate | Real data, not guesswork; no hallucinated schools |
| List structure | Reach / Target / Safety, ~10 schools | Standard counselor framing; "set clear expectations" |
| Interaction | Chat-style refine loop (split view) | Counseling is iterative, not one-and-done |
| LLM layer | Model-agnostic, **default Gemini** | Free tier → $0; provider is a one-line config swap |
| Privacy | De-identify before LLM | Keeps real student PII out of the model and logs |
| Vector search | Stretch (build-time embeddings + cosine) | Semantic program match; core works without it |
| Excluded infra | No Mongo/Redis/S3/Express | Stateless function; adding them = cargo-culting |
| Host | Vercel | Free; zero-config for Next.js; one `git push` |
