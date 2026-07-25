/**
 * Provider seam for embeddings, over the Vercel AI SDK's `embedMany`.
 * Framework-free. Mirrors `llm.ts`: `createEmbeddingProvider` wraps a concrete
 * model (the testable seam — Task 6 injects a fake); `getEmbeddingProvider`
 * resolves the Google embedding model with an explicitly-passed API key.
 *
 * Embeddings always use Google's `gemini-embedding-001` (the SDK's current
 * embedding model), independent of the configured chat provider. The 256-dim
 * Matryoshka reduction is requested via `providerOptions.google` on each call;
 * results are L2-normalized (required after reducing dimensionality) so
 * downstream cosine is a plain dot product.
 */
import { embedMany, type EmbeddingModel } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { resolveSecret } from "./secrets";
import { PROVIDER_DEFAULTS } from "./config";
import { EMBEDDING_MODEL, EMBEDDING_DIM, l2normalize } from "./embeddings";

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<Float32Array[]>;
}

// --- Google embedding call options (named — no magic strings) ----------------
/** The `providerOptions` namespace the AI SDK routes Google-specific options through. */
const GOOGLE_PROVIDER_OPTIONS = "google";
/** Task type: we compare interest text against program text symmetrically. */
const EMBEDDING_TASK_TYPE = "SEMANTIC_SIMILARITY";

/** Wrap a concrete AI-SDK embedding model as an EmbeddingProvider (testable seam). */
export function createEmbeddingProvider(model: EmbeddingModel): EmbeddingProvider {
  return {
    async embed(texts: string[]): Promise<Float32Array[]> {
      if (texts.length === 0) return [];
      const { embeddings } = await embedMany({
        model,
        values: texts,
        providerOptions: {
          [GOOGLE_PROVIDER_OPTIONS]: {
            outputDimensionality: EMBEDDING_DIM,
            taskType: EMBEDDING_TASK_TYPE,
          },
        },
      });
      return embeddings.map((e) => l2normalize(Float32Array.from(e)));
    },
  };
}

/** Resolve the Google embedding model (key from env -> Keychain) into a provider. */
export function getEmbeddingProvider(): EmbeddingProvider {
  const keyEnvVar = PROVIDER_DEFAULTS.google.apiKeyEnvVar;
  const apiKey = resolveSecret(keyEnvVar);
  if (!apiKey) {
    throw new Error(
      `Missing Google API key for embeddings: set ${keyEnvVar} as an env var, or add it to the ` +
        `macOS Keychain — security add-generic-password -a "$USER" -s ${keyEnvVar} -w '<key>'`
    );
  }
  const model = createGoogleGenerativeAI({ apiKey }).textEmbeddingModel(EMBEDDING_MODEL);
  return createEmbeddingProvider(model);
}
