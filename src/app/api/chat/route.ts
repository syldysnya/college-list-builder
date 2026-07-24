/**
 * `POST /api/chat` — the orchestration heart of the app.
 *
 * Pipeline per turn (all client-held state is re-sent every request; the server
 * is stateless): validate → de-identify → route (one LLM turn) → on a `list`
 * decision, `buildList` (deterministic) then `curate` (a second LLM turn) →
 * respond with the merged profile, the list, and the detected student name.
 *
 * NON-streaming: the complete `ChatResponse` is returned at once. Token/cost
 * trace recording is a later task and intentionally absent here.
 *
 * Privacy: the counselor's RAW text is never logged and never leaves this
 * function — only `maskPII`-masked text reaches the LLM. The detected name is
 * returned to the client (for its PDF header) but is never sent to the model.
 */
import { maskPII } from "@/lib/deidentify";
import { route } from "@/lib/router";
import { buildList } from "@/lib/matching";
import { loadColleges } from "@/lib/dataset";
import { curate } from "@/lib/curate";
import { getProvider, type LLMProvider } from "@/lib/llm";
import {
  ChatRequest,
  ChatAction,
  ChatMessage,
  emptyProfile,
  type CollegeList,
  type StudentProfile,
  type ChatResponse,
} from "@/lib/types";
import { limits } from "@/lib/config";

// --- Resilience knobs (named — no magic numbers) -----------------------------
/** Hard ceiling for a single LLM call before it is treated as a failure. */
const LLM_TIMEOUT_MS = 30_000;
/** Initial attempt + one retry on throw/timeout. */
const LLM_MAX_ATTEMPTS = 2;

// --- Client-facing error messages (specific — each names the actual problem) --
const ERR_INVALID_JSON = "The request body wasn't valid JSON.";
const ERR_INVALID_BODY = "The request was malformed. Please refresh and try again.";
const ERR_INPUT_TOO_LONG = "That description is too long. Please shorten it and try again.";
const ERR_NOT_CONFIGURED =
  "The assistant isn't set up yet: no API key was found. Add one (macOS Keychain or an env var) and restart the server.";
const ERR_TIMEOUT = "The assistant took too long to respond. Please try again.";
const ERR_RATE_LIMITED = "Too many requests right now. Wait a few seconds, then try again.";
const ERR_UPSTREAM_REJECTED =
  "The AI provider rejected the request. The API key may be invalid or out of quota.";
const ERR_UNAVAILABLE = "The assistant is temporarily unavailable. Please try again.";

/** The exact message `withTimeout` rejects with — shared so the classifier can match it. */
const TIMEOUT_REASON = "LLM call timed out";

// --- Server-log tags (named — no magic strings; these hit stderr, never the client) ---
const LOG_PREFIX = "[api/chat]";
const LOG_CONFIG_FAILED = "configuration error — the LLM provider could not be initialized";
const LOG_PIPELINE_FAILED = "chat pipeline failed";
const STAGE_ROUTE = "route";
const STAGE_CURATE = "curate";

// --- HTTP ---------------------------------------------------------------------
const STATUS_BAD_REQUEST = 400;
const STATUS_TOO_MANY_REQUESTS = 429;
const STATUS_BAD_GATEWAY = 502;
const STATUS_SERVICE_UNAVAILABLE = 503;
const STATUS_GATEWAY_TIMEOUT = 504;
// Upstream (AI provider) HTTP codes we special-case.
const UPSTREAM_TOO_MANY_REQUESTS = 429;
const UPSTREAM_UNAUTHORIZED = 401;
const UPSTREAM_FORBIDDEN = 403;
const JSON_HEADERS = { "Content-Type": "application/json" } as const;

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: JSON_HEADERS });
}

/** The AI SDK stamps `statusCode` on API-call errors; pull it out when present. */
function upstreamStatus(error: unknown): number | undefined {
  if (error !== null && typeof error === "object" && "statusCode" in error) {
    const code = (error as { statusCode?: unknown }).statusCode;
    if (typeof code === "number") return code;
  }
  return undefined;
}

/**
 * Map a runtime pipeline error to a specific client message + HTTP status, so
 * the user sees *why* it failed (timeout vs. rate limit vs. rejected key)
 * rather than one catch-all line. Falls back to a generic "unavailable".
 */
function classifyPipelineError(error: unknown): { status: number; message: string } {
  if (error instanceof Error && error.message === TIMEOUT_REASON) {
    return { status: STATUS_GATEWAY_TIMEOUT, message: ERR_TIMEOUT };
  }
  const status = upstreamStatus(error);
  if (status === UPSTREAM_TOO_MANY_REQUESTS) {
    return { status: STATUS_TOO_MANY_REQUESTS, message: ERR_RATE_LIMITED };
  }
  if (status === UPSTREAM_UNAUTHORIZED || status === UPSTREAM_FORBIDDEN) {
    return { status: STATUS_BAD_GATEWAY, message: ERR_UPSTREAM_REJECTED };
  }
  return { status: STATUS_SERVICE_UNAVAILABLE, message: ERR_UNAVAILABLE };
}

/**
 * Format an error for a server-side log line. Extracts only `name`/`message`/
 * `stack` — none of which carry the de-identified prompt, let alone the raw
 * counselor text (which never leaves `POST` and never reaches an error). This
 * keeps student PII out of logs while still surfacing the real cause.
 */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`;
  return String(error);
}

/** Total characters across every message's `content`. */
function totalContentChars(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + m.content.length, 0);
}

/** Race a promise against a timeout that rejects after `ms`, always clearing the timer. */
async function withTimeout<T>(op: () => Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(TIMEOUT_REASON)), ms);
  });
  try {
    return await Promise.race([op(), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Run an LLM call with a timeout, retrying once on throw/timeout before giving
 * up. Every failed attempt is logged with its `stage` so a transient failure is
 * visible even when the retry ultimately succeeds.
 */
async function withResilience<T>(stage: string, op: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= LLM_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await withTimeout(op, LLM_TIMEOUT_MS);
    } catch (error) {
      lastError = error;
      console.warn(
        `${LOG_PREFIX} ${stage} attempt ${attempt}/${LLM_MAX_ATTEMPTS} failed: ${describeError(error)}`
      );
    }
  }
  throw lastError;
}

/** De-identify each message and surface the most recent detected name (else null). */
function deidentify(messages: ChatMessage[]): { messages: ChatMessage[]; name: string | null } {
  let name: string | null = null;
  const masked = messages.map((m) => {
    const result = maskPII(m.content);
    if (result.name !== null) name = result.name;
    return { role: m.role, content: result.masked };
  });
  return { messages: masked, name };
}

export async function POST(req: Request): Promise<Response> {
  // 1. Parse + validate.
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError(ERR_INVALID_JSON, STATUS_BAD_REQUEST);
  }

  const parsed = ChatRequest.safeParse(raw);
  if (!parsed.success) {
    return jsonError(ERR_INVALID_BODY, STATUS_BAD_REQUEST);
  }
  const body = parsed.data;

  // 2. Input cap (total chars across all messages), then trim to the last N turns.
  if (totalContentChars(body.messages) > limits.maxInputChars) {
    return jsonError(ERR_INPUT_TOO_LONG, STATUS_BAD_REQUEST);
  }
  const recent = body.messages.slice(-limits.maxHistoryTurns);

  // 3. De-identify — only masked text goes to the LLM; raw text stays here.
  const { messages: deidentified, name: studentName } = deidentify(recent);

  // 4. Profile.
  const profile: StudentProfile = body.profile ?? emptyProfile();

  // 5. Resolve the provider. A failure here is a configuration problem (e.g. a
  //    missing API key) — permanent and non-retryable, so it is logged and
  //    handled distinctly from a transient LLM failure below.
  let provider: LLMProvider;
  try {
    provider = getProvider();
  } catch (error) {
    console.error(`${LOG_PREFIX} ${LOG_CONFIG_FAILED}: ${describeError(error)}`);
    return jsonError(ERR_NOT_CONFIGURED, STATUS_SERVICE_UNAVAILABLE);
  }

  try {
    // 6. Route (one LLM turn).
    const routed = await withResilience(STAGE_ROUTE, () =>
      route({ llm: provider, messages: deidentified, profile })
    );

    // 7. Branch on the model's decision. On "list" build + curate; "refuse" is
    //    the guardrail (no list). There is no clarifying-question path.
    let list: CollegeList | null = null;
    switch (routed.action) {
      case ChatAction.enum.list: {
        const base = buildList(routed.profile, loadColleges());
        list = await withResilience(STAGE_CURATE, () =>
          curate({ llm: provider, profile: routed.profile, list: base })
        );
        break;
      }
      case ChatAction.enum.refuse: {
        break;
      }
      default: {
        // Exhaustiveness guard: a new ChatAction must be handled above.
        const unreachable: never = routed.action;
        throw new Error(`Unhandled action: ${String(unreachable)}`);
      }
    }

    // 8. Respond.
    const responseBody: ChatResponse = {
      reply: routed.reply,
      action: routed.action,
      profile: routed.profile,
      list,
      studentName,
    };
    return new Response(JSON.stringify(responseBody), { status: 200, headers: JSON_HEADERS });
  } catch (error) {
    // 9. Never a silent empty list — log the cause, surface a specific error.
    console.error(`${LOG_PREFIX} ${LOG_PIPELINE_FAILED}: ${describeError(error)}`);
    const { status, message } = classifyPipelineError(error);
    return jsonError(message, status);
  }
}
