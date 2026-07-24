/**
 * Token cost calculation for LLM usage.
 * Framework-free: no imports from Next/React.
 */

import { MODELS } from "./config";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

// $ per 1,000,000 tokens. Numeric prices are data; keys reference the shared MODELS.
export const PRICING: Record<string, { inputPer1m: number; outputPer1m: number }> = {
  [MODELS.geminiFlash]: { inputPer1m: 0.3, outputPer1m: 2.5 },
  [MODELS.claudeSonnet]: { inputPer1m: 3.0, outputPer1m: 15.0 },
  [MODELS.gptMini]: { inputPer1m: 0.15, outputPer1m: 0.6 },
};

export const DEFAULT_PRICING = { inputPer1m: 3.0, outputPer1m: 15.0 } as const;

/** Cost in USD for a usage on a model. Unknown model → DEFAULT_PRICING (never NaN). */
export function costOf(usage: Usage, model: string): number {
  const pricing = PRICING[model] ?? DEFAULT_PRICING;
  return (
    (usage.inputTokens * pricing.inputPer1m) / 1_000_000 +
    (usage.outputTokens * pricing.outputPer1m) / 1_000_000
  );
}
