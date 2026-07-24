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
import { getProvider } from "@/lib/llm";
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

// --- Error messages (named — no magic strings) -------------------------------
const ERR_INVALID_JSON = "Invalid JSON body.";
const ERR_INVALID_BODY = "Invalid request body.";
const ERR_INPUT_TOO_LONG = "Input too long.";
const ERR_LLM_FAILED = "The assistant is temporarily unavailable. Please try again.";

// --- HTTP ---------------------------------------------------------------------
const STATUS_BAD_REQUEST = 400;
const STATUS_SERVER_ERROR = 500;
const JSON_HEADERS = { "Content-Type": "application/json" } as const;

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: JSON_HEADERS });
}

/** Total characters across every message's `content`. */
function totalContentChars(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + m.content.length, 0);
}

/** Race a promise against a timeout that rejects after `ms`, always clearing the timer. */
async function withTimeout<T>(op: () => Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("LLM call timed out")), ms);
  });
  try {
    return await Promise.race([op(), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Run an LLM call with a timeout, retrying once on throw/timeout before giving up. */
async function withResilience<T>(op: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < LLM_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await withTimeout(op, LLM_TIMEOUT_MS);
    } catch (error) {
      lastError = error;
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

  try {
    const provider = getProvider();

    // 5. Route (one LLM turn).
    const routed = await withResilience(() =>
      route({
        llm: provider,
        messages: deidentified,
        profile,
        clarifyingCount: body.clarifyingCount,
      })
    );

    // 6. Branch on the model's decision.
    let list: CollegeList | null = null;
    let clarifyingCount = body.clarifyingCount;
    switch (routed.action) {
      case ChatAction.enum.list: {
        const base = buildList(routed.profile, loadColleges());
        list = await withResilience(() =>
          curate({ llm: provider, profile: routed.profile, list: base })
        );
        break;
      }
      case ChatAction.enum.ask: {
        clarifyingCount = body.clarifyingCount + 1;
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

    // 7. Respond.
    const responseBody: ChatResponse = {
      reply: routed.reply,
      action: routed.action,
      profile: routed.profile,
      list,
      clarifyingCount,
      studentName,
    };
    return new Response(JSON.stringify(responseBody), { status: 200, headers: JSON_HEADERS });
  } catch {
    // 8. Never a silent empty list — surface a clear error instead.
    return jsonError(ERR_LLM_FAILED, STATUS_SERVER_ERROR);
  }
}
