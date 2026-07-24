import { describe, it, expect } from "vitest";
import { maskPII, STUDENT_PLACEHOLDER } from "./deidentify";

describe("maskPII", () => {
  it("detects a cue-based name and masks it while preserving other content", () => {
    const { masked, name } = maskPII("I have a student named John Smith, 1230 SAT");
    expect(name).toBe("John Smith");
    expect(masked).toContain(STUDENT_PLACEHOLDER);
    expect(masked).not.toContain("John Smith");
    expect(masked).toContain("1230");
  });

  it("removes an email and a phone number from the masked text", () => {
    const { masked } = maskPII(
      "Reach the family at jane.doe@example.com or call (415) 555-0134 for more info.",
    );
    expect(masked).not.toContain("jane.doe@example.com");
    expect(masked).not.toContain("415");
    expect(masked).not.toContain("555-0134");
  });

  it("removes a street address from the masked text", () => {
    const { masked } = maskPII("They live at 1234 Maple Street near campus.");
    expect(masked).not.toContain("1234 Maple Street");
    expect(masked).toContain("near campus");
  });

  it("returns null name and preserves text when no name is present", () => {
    const { masked, name } = maskPII("quiet kid, loves marine biology, needs aid");
    expect(name).toBeNull();
    expect(masked).toBe("quiet kid, loves marine biology, needs aid");
  });

  it("does not misfire on stopword phrases like 'Human Geo' or 'New York'", () => {
    const { name } = maskPII("3 on Human Geo, wants schools in New York");
    if (name !== null) {
      expect(name).not.toBe("Human Geo");
      expect(name).not.toBe("New York");
    }
  });

  it("masks every occurrence of a repeated name", () => {
    const { masked, name } = maskPII(
      "The student named Maria Lopez is strong in STEM. Maria Lopez wants a mid-size school.",
    );
    expect(name).toBe("Maria Lopez");
    expect(masked).not.toContain("Maria Lopez");
    const occurrences = masked.split(STUDENT_PLACEHOLDER).length - 1;
    expect(occurrences).toBe(2);
  });

  it("falls back to the first capitalized bigram when there is no cue word", () => {
    const { masked, name } = maskPII("Emma Carter is applying with a 3.9 GPA and loves AP Bio.");
    expect(name).toBe("Emma Carter");
    expect(masked).toContain(STUDENT_PLACEHOLDER);
    expect(masked).not.toContain("Emma Carter");
    expect(masked).toContain("GPA");
  });
});
