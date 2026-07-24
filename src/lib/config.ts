/**
 * Env-driven LLM config + app-wide limits.
 * Framework-free: no imports from Next/React.
 *
 * Enum pattern (matches src/lib/types.ts): each domain is declared once as an
 * `as const` tuple; every other value in this module (default model, provider
 * default, etc.) is referenced by name off that tuple or a `Record` keyed by
 * it — no bare string literal is ever written outside its definition.
 */

// --- Enum domain --------------------------------------------------------------
export const PROVIDERS = ["google", "anthropic", "openai"] as const;
export type Provider = (typeof PROVIDERS)[number];

// --- Model identifiers (single source; also used by pricing) -------------------
export const MODELS = {
  geminiFlash: "gemini-2.5-flash",
  claudeSonnet: "claude-sonnet-5",
  gptMini: "gpt-4o-mini",
} as const;

// --- Per-provider defaults -----------------------------------------------------
export const PROVIDER_DEFAULTS: Record<Provider, { model: string; apiKeyEnvVar: string }> = {
  google: { model: MODELS.geminiFlash, apiKeyEnvVar: "GOOGLE_GENERATIVE_AI_API_KEY" },
  anthropic: { model: MODELS.claudeSonnet, apiKeyEnvVar: "ANTHROPIC_API_KEY" },
  openai: { model: MODELS.gptMini, apiKeyEnvVar: "OPENAI_API_KEY" },
};

export const DEFAULT_PROVIDER: Provider = PROVIDERS[0];

export interface LlmConfig {
  provider: Provider;
  model: string;
}

function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value);
}

/**
 * Reads LLM_PROVIDER / LLM_MODEL from env (defaults: google / that provider's
 * default model). Throws a clear Error if LLM_PROVIDER is not a known
 * provider, or if the provider's API key env var is missing/empty. `env`
 * defaults to process.env (injectable for tests).
 */
export function getLlmConfig(env: Record<string, string | undefined> = process.env): LlmConfig {
  const rawProvider = env.LLM_PROVIDER;
  if (rawProvider !== undefined && !isProvider(rawProvider)) {
    throw new Error(
      `Invalid LLM_PROVIDER "${rawProvider}": expected one of ${PROVIDERS.join(", ")}`
    );
  }
  const provider: Provider = rawProvider ?? DEFAULT_PROVIDER;

  const providerDefaults = PROVIDER_DEFAULTS[provider];
  const model = env.LLM_MODEL ?? providerDefaults.model;

  const apiKey = env[providerDefaults.apiKeyEnvVar];
  if (!apiKey) {
    throw new Error(
      `Missing API key for provider "${provider}": set ${providerDefaults.apiKeyEnvVar}`
    );
  }

  return { provider, model };
}

// --- App-wide limits/knobs (named — no magic numbers at call sites) -----------
export const tierTargets = { perTier: 4, min: 2 } as const;
export const limits = {
  maxInputChars: 4000,
  maxHistoryTurns: 12,
  maxOutputTokens: 1024,
  maxClarifyingQuestions: 2,
} as const;
