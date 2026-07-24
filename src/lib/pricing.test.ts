import { describe, it, expect } from "vitest";
import { costOf, PRICING, DEFAULT_PRICING } from "./pricing";
import { MODELS } from "./config";

const PER_1M = 1_000_000;

describe("costOf", () => {
  it("charges exactly the per-1M input rate for 1M input tokens with no output", () => {
    const gemini = PRICING[MODELS.geminiFlash]!;
    expect(costOf({ inputTokens: PER_1M, outputTokens: 0 }, MODELS.geminiFlash)).toBeCloseTo(
      gemini.inputPer1m
    );
  });

  it("falls back to DEFAULT_PRICING for an unknown model (finite, not NaN)", () => {
    const cost = costOf({ inputTokens: PER_1M, outputTokens: PER_1M }, "some-unknown-model");
    expect(Number.isNaN(cost)).toBe(false);
    expect(cost).toBeCloseTo(DEFAULT_PRICING.inputPer1m + DEFAULT_PRICING.outputPer1m);
  });

  it("computes input+output cost for a mixed usage", () => {
    const p = PRICING[MODELS.gptMini]!;
    const cost = costOf({ inputTokens: 500_000, outputTokens: 200_000 }, MODELS.gptMini);
    expect(cost).toBeCloseTo((500_000 * p.inputPer1m) / PER_1M + (200_000 * p.outputPer1m) / PER_1M);
  });
});
