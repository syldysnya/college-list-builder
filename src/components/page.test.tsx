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

  it("sends a message, renders the returned list, and disables/enables download", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => chatResponse(),
    } as Response);

    render(<Home />);

    const downloadButton = screen.getByRole("button", { name: content.ui.downloadLabel });
    expect(downloadButton).toBeDisabled();

    const textarea = screen.getByPlaceholderText(content.ui.inputPlaceholder);
    fireEvent.change(textarea, { target: { value: "A marine biology student." } });
    fireEvent.click(screen.getByRole("button", { name: content.ui.sendLabel }));

    // Assistant reply lands in the transcript.
    expect(await screen.findByText(ASSISTANT_REPLY)).toBeInTheDocument();

    // The tier section + at least one school card render.
    expect(screen.getByText(content.tiers.reach)).toBeInTheDocument();
    expect(screen.getByText(SCHOOL_NAME)).toBeInTheDocument();

    // Download is enabled once a list exists.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: content.ui.downloadLabel })).toBeEnabled(),
    );
  });
});
