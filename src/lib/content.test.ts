import { describe, it, expect } from "vitest";
import { content } from "./content";

describe("content", () => {
  it("exposes non-empty app name and metadata", () => {
    expect(content.appName.length).toBeGreaterThan(0);
    expect(content.meta.title.length).toBeGreaterThan(0);
    expect(content.meta.description.length).toBeGreaterThan(0);
  });

  it("uses a single source of truth for the app name", () => {
    expect(content.meta.title).toBe(content.appName);
    expect(content.hero.title).toBe(content.appName);
  });
});
