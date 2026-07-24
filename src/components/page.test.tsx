// @vitest-environment jsdom
/**
 * Light integration test for the split-view page: empty state → send a message
 * that returns a list → tiers/cards render and the transcript updates → the
 * Download-PDF control flips from disabled to enabled. `fetch` is mocked, so no
 * network or LLM is touched.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import Home from "@/app/page";
import { content } from "@/lib/content";
import {
  ChatAction,
  Region,
  CollegeSetting,
  CollegeClimate,
  type ChatResponse,
  type CollegeList,
  type StudentProfile,
} from "@/lib/types";

const SCHOOL_NAME = "Coastal State University";
const ASSISTANT_REPLY = "Here is a starter list for your student.";

function sampleList(): CollegeList {
  return {
    studentName: "Test Student",
    assumptions: ["Assumed test-optional applications."],
    reach: [
      {
        college: {
          id: "coastal-state",
          name: SCHOOL_NAME,
          city: "Santa Cruz",
          state: "CA",
          region: Region.enum.west,
          satP25: 1200,
          satP75: 1400,
          admitRate: 0.42,
          netPrice: 18500,
          pctNeedMet: 0.8,
          enrollment: 15000,
          setting: CollegeSetting.enum.suburban,
          climate: CollegeClimate.enum.warm,
          programStrengths: ["Marine Biology"],
          tags: [],
        },
        fitScore: 0.9,
        tier: "reach",
        rationale: "Strong marine biology program near the coast.",
      },
    ],
    target: [],
    safety: [],
  };
}

function chatResponse(): ChatResponse {
  return {
    reply: ASSISTANT_REPLY,
    action: ChatAction.enum.list,
    profile: {} as StudentProfile,
    list: sampleList(),
    clarifyingCount: 0,
    studentName: "Test Student",
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Home split-view page", () => {
  it("renders the empty state with example prompts before any message", () => {
    render(<Home />);
    expect(screen.getByText(content.ui.emptyHeading)).toBeInTheDocument();
    for (const example of content.examples) {
      expect(screen.getByText(example.label)).toBeInTheDocument();
    }
  });

  it("hides the list panel until a message generates a list, then auto-opens it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => chatResponse(),
    } as Response);

    render(<Home />);

    // No list panel (hence no download control, no school) before the first message.
    expect(
      screen.queryByRole("button", { name: content.ui.downloadLabel }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(SCHOOL_NAME)).not.toBeInTheDocument();

    const textarea = screen.getByPlaceholderText(content.ui.inputPlaceholder);
    fireEvent.change(textarea, { target: { value: "A marine biology student." } });
    fireEvent.click(screen.getByRole("button", { name: content.ui.sendLabel }));

    // Assistant reply lands in the transcript.
    expect(await screen.findByText(ASSISTANT_REPLY)).toBeInTheDocument();

    // The panel popped open: tier section + school card render, download enabled.
    expect(screen.getByText(content.tiers.reach)).toBeInTheDocument();
    expect(screen.getByText(SCHOOL_NAME)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: content.ui.downloadLabel })).toBeEnabled(),
    );
  });

  it("closes the panel via the X and reopens it via View list", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => chatResponse(),
    } as Response);

    render(<Home />);

    const textarea = screen.getByPlaceholderText(content.ui.inputPlaceholder);
    fireEvent.change(textarea, { target: { value: "A marine biology student." } });
    fireEvent.click(screen.getByRole("button", { name: content.ui.sendLabel }));
    await screen.findByText(ASSISTANT_REPLY);
    expect(screen.getByText(SCHOOL_NAME)).toBeInTheDocument();

    // Close hides the panel (and its list content).
    fireEvent.click(screen.getByRole("button", { name: content.ui.closeLabel }));
    expect(screen.queryByText(SCHOOL_NAME)).not.toBeInTheDocument();

    // "View list" reopens it.
    fireEvent.click(screen.getByRole("button", { name: content.ui.showListLabel }));
    expect(screen.getByText(SCHOOL_NAME)).toBeInTheDocument();
  });
});
