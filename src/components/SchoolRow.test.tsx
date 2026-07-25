// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SchoolRow } from "./SchoolRow";
import { content } from "@/lib/content";
import type { College, ScoredCollege } from "@/lib/types";

function college(overrides: Partial<College> = {}): College {
  return {
    id: "u1",
    name: "Test University",
    city: "Townsville",
    state: "CA",
    region: "west",
    satP25: 1200,
    satP75: 1400,
    admitRate: 0.42,
    netPrice: 18500,
    enrollment: 15000,
    setting: "urban",
    climate: "warm",
    ownership: "private",
    type: "research",
    programs: ["Computer Science"],
    ...overrides,
  };
}

function scored(collegeOverrides: Partial<College> = {}, extra: Partial<ScoredCollege> = {}): ScoredCollege {
  return {
    college: college(collegeOverrides),
    fitScore: 80,
    admitChance: 0.55,
    rationale: "Strong program fit near the coast.",
    ...extra,
  };
}

afterEach(cleanup);

describe("SchoolRow", () => {
  it("renders name, location, the admit-chance chip, and rationale", () => {
    render(<SchoolRow scored={scored()} />);
    expect(screen.getByText("Test University")).toBeInTheDocument();
    expect(screen.getByText("Townsville, CA")).toBeInTheDocument();
    expect(screen.getByText(content.stats.chance)).toBeInTheDocument();
    expect(screen.getByText("55%")).toBeInTheDocument(); // admitChance 0.55 → 55%
    expect(screen.getByText("Strong program fit near the coast.")).toBeInTheDocument();
  });

  it("shows a test-optional chip when the school has no SAT band", () => {
    render(<SchoolRow scored={scored({ satP25: null, satP75: null })} />);
    expect(screen.getByText(content.stats.testOptional)).toBeInTheDocument();
  });

  it("links to the College Scorecard source in a new tab", () => {
    render(<SchoolRow scored={scored()} />);
    const link = screen.getByRole("link", { name: content.sources.scorecardLabel });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("href")).toContain("collegescorecard.ed.gov");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});
