import { describe, it, expect } from "vitest";
import { getLlmConfig, MODELS } from "./config";

describe("getLlmConfig", () => {
  it("defaults to google + its default model when the google key is set", () => {
    const config = getLlmConfig({ GOOGLE_GENERATIVE_AI_API_KEY: "x" });
    expect(config).toEqual({ provider: "google", model: MODELS.geminiFlash });
  });

  it("uses the anthropic default model when LLM_PROVIDER=anthropic and no LLM_MODEL override", () => {
    const config = getLlmConfig({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "x" });
    expect(config).toEqual({ provider: "anthropic", model: MODELS.claudeSonnet });
  });

  it("respects an LLM_MODEL override", () => {
    const overrideModel = "custom-model-x"; // arbitrary non-default id
    const config = getLlmConfig({
      LLM_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "x",
      LLM_MODEL: overrideModel,
    });
    expect(config.model).toBe(overrideModel);
  });

  it("throws naming the missing env var when no key is set", () => {
    expect(() => getLlmConfig({})).toThrow(/GOOGLE_GENERATIVE_AI_API_KEY/);
  });

  it("throws on an invalid LLM_PROVIDER", () => {
    expect(() => getLlmConfig({ LLM_PROVIDER: "foo" })).toThrow(/foo/);
  });
});
