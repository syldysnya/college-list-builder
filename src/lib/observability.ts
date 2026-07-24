/**
 * Per-turn trace recorder + in-memory ring buffer.
 * Framework-free: no imports from Next/React.
 *
 * A RequestTrace captures one API turn: the ordered LLM/match steps it ran plus
 * rolled-up token and cost totals. Traces are kept in a bounded, module-level
 * ring buffer for local dev/demo introspection (per-instance, not durable).
 *
 * Enum pattern (matches src/lib/config.ts and types.ts): the step-kind domain is
 * declared once as an `as const` tuple; the buffer size is a named const. No bare
 * string literal or magic number is written outside its definition.
 */
import { ChatAction } from "./types";

// --- Step-kind domain (LLM invocations) --------------------------------------
export const STEP_KINDS = ["router", "curate", "embed"] as const;
export type StepKind = (typeof STEP_KINDS)[number];

/** The literal tag distinguishing a (non-LLM) match step from an invocation. */
export const MATCH_STEP = "match" as const;

/** One LLM invocation within a turn: which step, model, tokens, cost, latency. */
export interface InvocationRecord {
  step: StepKind;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
  durationMs: number;
}

/** One deterministic matching step within a turn (no model / tokens). */
export interface MatchStep {
  step: typeof MATCH_STEP;
  durationMs: number;
  scored: number;
}

export type TraceStep = InvocationRecord | MatchStep;

/** A full record of one API turn. `id`/`ts` are supplied by the caller. */
export interface RequestTrace {
  id: string;
  ts: string;
  action: ChatAction;
  steps: TraceStep[];
  totalTokens: number;
  totalCostUSD: number;
}

// --- In-memory ring buffer (local dev/demo only — per-instance, not durable) --
export const RING_BUFFER_SIZE = 50;

const buffer: RequestTrace[] = [];

/** Append a trace, keeping only the last RING_BUFFER_SIZE (oldest dropped). */
export function recordTrace(trace: RequestTrace): void {
  buffer.push(trace);
  if (buffer.length > RING_BUFFER_SIZE) {
    buffer.splice(0, buffer.length - RING_BUFFER_SIZE);
  }
}

/** Newest-first copy of the buffered traces. */
export function recentTraces(): RequestTrace[] {
  return [...buffer].reverse();
}

/** Empty the buffer (for tests). */
export function clearTraces(): void {
  buffer.length = 0;
}
