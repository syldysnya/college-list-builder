/**
 * Provider seam for embeddings, over the Vercel AI SDK's `embedMany`.
 * Framework-free. Mirrors `llm.ts`: `createEmbeddingProvider` wraps a concrete
 * model (the testable seam — Task 6 injects a fake); `getEmbeddingProvider`
 * resolves the Google embedding model with an explicitly-passed API key.
 *
 * Embeddings always use Google's `text-embedding-004`, independent of the
 * configured chat provider. Results are L2-normalized so downstream cosine is a
 * plain dot product.
 */
import { embedMany, type EmbeddingModel } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { resolveSecret } from "./secrets";
import { PROVIDER_DEFAULTS } from "./config";
import { EMBEDDING_MODEL, l2normalize } from "./embeddings";

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<Float32Array[]>;
}

/** Wrap a concrete AI-SDK embedding model as an EmbeddingProvider (testable seam). */
export function createEmbeddingProvider(model: EmbeddingModel): EmbeddingProvider {
  return {
    async embed(texts: string[]): Promise<Float32Array[]> {
      if (texts.length === 0) return [];
      const { embeddings } = await embedMany({ model, values: texts });
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
