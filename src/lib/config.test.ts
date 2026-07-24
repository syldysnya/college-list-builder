import { describe, it, expect } from "vitest";
import { getLlmConfig, MODELS } from "./config";

// A Keychain reader that always misses — keeps env-driven cases hermetic (no
// dependence on whatever the dev machine actually has stored).
const noKeychain = () => "";

describe("getLlmConfig", () => {
  it("defaults to google + its default model when the google key is set in env", () => {
    const config = getLlmConfig({ GOOGLE_GENERATIVE_AI_API_KEY: "x" }, noKeychain);
    expect(config).toEqual({ provider: "google", model: MODELS.geminiFlash, apiKey: "x" });
  });

  it("uses the anthropic default model when LLM_PROVIDER=anthropic and no LLM_MODEL override", () => {
    const config = getLlmConfig({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "x" }, noKeychain);
    expect(config).toEqual({ provider: "anthropic", model: MODELS.claudeSonnet, apiKey: "x" });
  });

  it("respects an LLM_MODEL override", () => {
    const overrideModel = "custom-model-x"; // arbitrary non-default id
    const config = getLlmConfig(
      { LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "x", LLM_MODEL: overrideModel },
      noKeychain
    );
    expect(config.model).toBe(overrideModel);
  });

  it("falls back to the Keychain when the key is not in env", () => {
    const config = getLlmConfig({}, () => "from-keychain");
    expect(config.apiKey).toBe("from-keychain");
  });

  it("throws naming the missing key when it is in neither env nor Keychain", () => {
    expect(() => getLlmConfig({}, noKeychain)).toThrow(/GOOGLE_GENERATIVE_AI_API_KEY/);
  });

  it("throws on an invalid LLM_PROVIDER", () => {
    expect(() => getLlmConfig({ LLM_PROVIDER: "foo" }, noKeychain)).toThrow(/foo/);
  });
});
