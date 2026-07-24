/**
 * Model-agnostic LLM provider over the Vercel AI SDK.
 * Framework-free: no imports from Next/React.
 *
 * `LLMProvider` is a thin, testable seam over the AI SDK's `generateObject` /
 * `generateText` / `streamText`. `createProvider` wraps a concrete model (the
 * seam tests inject a mock here); `getProvider` resolves the env-configured
 * provider+model into a live model. AI-SDK usage is mapped onto our own `Usage`.
 */
import { generateObject, generateText, streamText, type LanguageModel } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { Usage } from "./pricing";
import { LlmConfig, getLlmConfig, PROVIDERS } from "./config";

/** The subset of an AI-SDK usage object we consume (fields are optional there). */
interface SdkUsage {
  inputTokens?: number;
  outputTokens?: number;
}

/** Map an AI-SDK usage object onto our `Usage` (absent counts → 0). */
function mapUsage(usage: SdkUsage): Usage {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
  };
}

export interface LLMProvider {
  generateObject<T>(o: {
    schema: z.ZodType<T>;
    prompt: string;
    system?: string;
  }): Promise<{ value: T; usage: Usage }>;
  generateText(o: {
    prompt: string;
    system?: string;
  }): Promise<{ text: string; usage: Usage }>;
  streamText(o: {
    prompt: string;
    system?: string;
  }): { textStream: AsyncIterable<string>; usage: Promise<Usage> };
}

/** Wrap a concrete AI-SDK model as an LLMProvider (this is the testable seam). */
export function createProvider(model: LanguageModel): LLMProvider {
  return {
    async generateObject<T>(o: {
      schema: z.ZodType<T>;
      prompt: string;
      system?: string;
    }): Promise<{ value: T; usage: Usage }> {
      const { object, usage } = await generateObject({
        model,
        schema: o.schema,
        prompt: o.prompt,
        system: o.system,
      });
      return { value: object as T, usage: mapUsage(usage) };
    },

    async generateText(o: {
      prompt: string;
      system?: string;
    }): Promise<{ text: string; usage: Usage }> {
      const { text, usage } = await generateText({
        model,
        prompt: o.prompt,
        system: o.system,
      });
      return { text, usage: mapUsage(usage) };
    },

    streamText(o: {
      prompt: string;
      system?: string;
    }): { textStream: AsyncIterable<string>; usage: Promise<Usage> } {
      const result = streamText({ model, prompt: o.prompt, system: o.system });
      return {
        textStream: result.textStream,
        usage: Promise.resolve(result.usage).then(mapUsage),
      };
    },
  };
}

/**
 * Build the concrete AI-SDK model for a resolved config. The API key (resolved
 * from env or the Keychain by `getLlmConfig`) is passed EXPLICITLY here, so the
 * SDK never has to read `process.env` itself.
 */
function modelFor(cfg: LlmConfig): LanguageModel {
  switch (cfg.provider) {
    case "google":
      return createGoogleGenerativeAI({ apiKey: cfg.apiKey })(cfg.model);
    case "anthropic":
      return createAnthropic({ apiKey: cfg.apiKey })(cfg.model);
    case "openai":
      throw new Error(
        `openai provider not wired — install @ai-sdk/openai (known providers: ${PROVIDERS.join(", ")})`
      );
    default: {
      // Exhaustiveness guard: a new Provider must be handled above.
      const unreachable: never = cfg.provider;
      throw new Error(`Unhandled provider: ${String(unreachable)}`);
    }
  }
}

/** Resolve the configured provider+model into an LLMProvider. */
export function getProvider(cfg: LlmConfig = getLlmConfig()): LLMProvider {
  return createProvider(modelFor(cfg));
}
