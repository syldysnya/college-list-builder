import { describe, it, expect } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("joins truthy class names and drops falsy ones", () => {
    expect(cn("a", "b")).toBe("a b");
    expect(cn("a", false && "b", null, undefined, "c")).toBe("a c");
  });

  it("merges conflicting Tailwind utilities so the last one wins", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-sm", "text-lg")).toBe("text-lg");
  });

  it("accepts array and object inputs (conditional classes)", () => {
    expect(cn(["a", "b"], { c: true, d: false })).toBe("a b c");
  });
});
