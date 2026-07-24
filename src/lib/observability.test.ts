import { describe, it, expect, beforeEach } from "vitest";
import {
  recordTrace,
  recentTraces,
  clearTraces,
  RING_BUFFER_SIZE,
  STEP_KINDS,
  MATCH_STEP,
  type RequestTrace,
} from "./observability";
import { CHAT_ACTIONS } from "./types";

function makeTrace(n: number): RequestTrace {
  return {
    id: `trace-${n}`,
    ts: `2026-07-24T00:00:${String(n).padStart(2, "0")}.000Z`,
    action: CHAT_ACTIONS[0],
    steps: [
      {
        step: STEP_KINDS[0],
        model: "test-model",
        inputTokens: n,
        outputTokens: n,
        costUSD: 0,
        durationMs: 1,
      },
      { step: MATCH_STEP, durationMs: 2, scored: n },
    ],
    totalTokens: 2 * n,
    totalCostUSD: 0,
  };
}

describe("observability ring buffer", () => {
  beforeEach(() => {
    clearTraces();
  });

  it("keeps only the last RING_BUFFER_SIZE traces", () => {
    const pushed = RING_BUFFER_SIZE + 10;
    for (let i = 0; i < pushed; i++) {
      recordTrace(makeTrace(i));
    }
    const traces = recentTraces();
    expect(traces).toHaveLength(RING_BUFFER_SIZE);
    // The oldest 10 were dropped; ids 10..pushed-1 survive.
    const ids = traces.map((t) => t.id).sort();
    expect(ids).not.toContain("trace-0");
    expect(ids).toContain(`trace-${pushed - 1}`);
    expect(ids).toContain(`trace-${pushed - RING_BUFFER_SIZE}`);
  });

  it("returns traces newest-first", () => {
    recordTrace(makeTrace(1));
    recordTrace(makeTrace(2));
    recordTrace(makeTrace(3));
    const ids = recentTraces().map((t) => t.id);
    expect(ids).toEqual(["trace-3", "trace-2", "trace-1"]);
  });

  it("returns a copy that does not mutate the buffer", () => {
    recordTrace(makeTrace(1));
    const first = recentTraces();
    first.push(makeTrace(99));
    expect(recentTraces()).toHaveLength(1);
  });

  it("clearTraces empties the buffer", () => {
    recordTrace(makeTrace(1));
    clearTraces();
    expect(recentTraces()).toHaveLength(0);
  });
});
