import { describe, it, expect } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { createProvider, getProvider } from "./llm";

// A LanguageModelV4 usage object with the given input/output token totals.
function usage(inputTotal: number, outputTotal: number) {
  return {
    inputTokens: { total: inputTotal, noCache: inputTotal, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: outputTotal, text: outputTotal, reasoning: 0 },
  };
}

const finishReason = { unified: "stop", raw: "stop" } as const;

describe("createProvider.generateObject", () => {
  it("returns the parsed object and mapped usage", async () => {
    const schema = z.object({ answer: z.string(), score: z.number() });
    const payload = { answer: "yes", score: 7 };
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: JSON.stringify(payload) }],
        finishReason,
        usage: usage(11, 5),
        warnings: [],
      }),
    });

    const { value, usage: mapped } = await createProvider(model).generateObject({
      schema,
      prompt: "give an answer",
    });

    expect(value).toEqual(payload);
    expect(mapped.inputTokens).toBe(11);
    expect(mapped.outputTokens).toBe(5);
  });
});

describe("createProvider.generateText", () => {
  it("returns text and mapped usage", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: "hello world" }],
        finishReason,
        usage: usage(3, 2),
        warnings: [],
      }),
    });

    const { text, usage: mapped } = await createProvider(model).generateText({
      prompt: "say hi",
    });

    expect(text).toBe("hello world");
    expect(mapped.inputTokens).toBe(3);
    expect(mapped.outputTokens).toBe(2);
  });
});

describe("createProvider shape", () => {
  it("exposes the three provider methods", () => {
    const provider = createProvider(new MockLanguageModelV4());
    expect(typeof provider.generateObject).toBe("function");
    expect(typeof provider.generateText).toBe("function");
    expect(typeof provider.streamText).toBe("function");
  });
});

describe("getProvider", () => {
  it("builds a google-backed provider without throwing", () => {
    expect(() => getProvider({ provider: "google", model: "gemini-2.5-flash" })).not.toThrow();
  });

  it("builds an anthropic-backed provider without throwing", () => {
    expect(() => getProvider({ provider: "anthropic", model: "claude-sonnet-5" })).not.toThrow();
  });

  it("throws a clear error for the unwired openai provider", () => {
    expect(() => getProvider({ provider: "openai", model: "gpt-4o-mini" })).toThrow(
      /openai provider not wired/
    );
  });
});
