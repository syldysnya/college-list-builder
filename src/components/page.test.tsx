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
    colleges: [
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
        fitScore: 90,
        admitChance: 0.42,
        rationale: "Strong marine biology program near the coast.",
      },
    ],
  };
}

function chatResponse(): ChatResponse {
  return {
    reply: ASSISTANT_REPLY,
    action: ChatAction.enum.list,
    profile: {} as StudentProfile,
    list: sampleList(),
    steps: ["Read the student's profile", "Ranked 35 colleges by admission chance and fit"],
    studentName: "Test Student",
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Home chat page", () => {
  it("renders the welcome before any message", () => {
    render(<Home />);
    expect(screen.getByText(content.ui.emptyHeading)).toBeInTheDocument();
    expect(screen.getByText(content.ui.emptySubtext)).toBeInTheDocument();
  });

  it("sends a message and renders the returned college list inline with a download button", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => chatResponse(),
    } as Response);

    render(<Home />);

    // No list content (hence no download control, no school) before the first message.
    expect(
      screen.queryByRole("button", { name: content.ui.downloadLabel }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(SCHOOL_NAME)).not.toBeInTheDocument();

    const textarea = screen.getByPlaceholderText(content.ui.inputPlaceholder);
    fireEvent.change(textarea, { target: { value: "A marine biology student." } });
    fireEvent.click(screen.getByRole("button", { name: content.ui.sendLabel }));

    // Assistant reply lands in the transcript, with the "Done thinking" trail.
    expect(await screen.findByText(ASSISTANT_REPLY)).toBeInTheDocument();
    expect(screen.getByText(content.ui.doneThinkingLabel)).toBeInTheDocument();

    // The college list renders inline: school card (with its admit-chance chip) + enabled download.
    expect(screen.getByText(SCHOOL_NAME)).toBeInTheDocument();
    expect(screen.getByText(content.stats.chance)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: content.ui.downloadLabel })).toBeEnabled(),
    );
  });
});
