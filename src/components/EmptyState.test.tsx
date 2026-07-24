// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { EmptyState } from "./EmptyState";
import { content } from "@/lib/content";

afterEach(cleanup);

describe("EmptyState", () => {
  it("renders the welcome heading and description (no example prompts)", () => {
    render(<EmptyState />);
    expect(screen.getByText(content.ui.emptyHeading)).toBeInTheDocument();
    expect(screen.getByText(content.ui.emptySubtext)).toBeInTheDocument();
  });
});
