// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Markdown } from "./Markdown";

afterEach(cleanup);

describe("Markdown", () => {
  it("renders headings and bold from markdown source", () => {
    render(<Markdown>{"## Heading\n\nSome **bold** text."}</Markdown>);
    expect(screen.getByRole("heading", { name: "Heading" })).toBeInTheDocument();
    expect(screen.getByText("bold")).toBeInTheDocument();
  });

  it("renders a numbered list", () => {
    render(<Markdown>{"1. First\n2. Second"}</Markdown>);
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("renders links that open in a new tab with rel=noopener", () => {
    render(<Markdown>{"[Drexel](https://example.com/drexel)"}</Markdown>);
    const link = screen.getByRole("link", { name: "Drexel" });
    expect(link).toHaveAttribute("href", "https://example.com/drexel");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});
