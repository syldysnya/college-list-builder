/**
 * Central copy for the app. All user-facing text lives here so wording changes
 * happen in one place — no strings hardcoded inside components.
 * Later tasks extend this (tier labels, PDF disclaimer, example prompts, etc.).
 */
const APP_NAME = "College List Builder";

export const content = {
  appName: APP_NAME,
  meta: {
    title: APP_NAME,
    description:
      "Turn a free-form description of a student into a data-informed college list, exportable as a PDF.",
  },
  hero: {
    title: APP_NAME,
    subtitle:
      "Describe a student in plain language and get a data-informed college list ranked by admission chance, exportable as a PDF.",
    status: "Coming soon.",
  },
  pdf: {
    disclaimer:
      "Data-informed suggestions from public data (U.S. DOE College Scorecard). Not a guarantee of admission or aid. Verify current figures with each college.",
    generatedPrefix: "Generated",
  },
  // --- Split-view UI copy -----------------------------------------------------
  ui: {
    appTagline: "Describe a student, build their list.",
    inputPlaceholder: "Ask a college-related question…",
    sendLabel: "Send",
    downloadLabel: "Download PDF",
    thinkingLabel: "Thinking…",
    retryLabel: "Retry",
    // Fallbacks when the server gives no specific message, or the request never reached it.
    errorGeneric: "Something went wrong. Please try again.",
    errorNetwork: "Couldn't reach the server. Check your connection and try again.",
    emptyHeading: "Describe a student to begin",
    emptySubtext:
      "Tell me about a student (grades, scores, interests, budget) and I'll build a ranked college list you can download as a PDF.",
    listHeading: "College list",
    assumptionsHeading: "Assumptions",
    downloadFilename: "college-list.pdf",
    conversationLabel: "Conversation",
  },
  // Formatting labels for a school's stat line (mirrors the PDF export).
  stats: {
    sat: "SAT",
    admitRate: "Admit rate",
    netPrice: "Est. net price",
    testOptional: "test-optional",
    chance: "Admit chance",
  },
  // Data source — a per-school link to the U.S. DOE College Scorecard.
  sources: {
    scorecardLabel: "College Scorecard",
    scorecardSearch: "https://collegescorecard.ed.gov/search/?search=",
  },
} as const;
