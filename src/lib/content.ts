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
      "Describe a student in plain language and get a data-informed college list — organized into Reach, Target, and Safety tiers, exportable as a PDF.",
    status: "Coming soon.",
  },
  tiers: { reach: "Reach", target: "Target", safety: "Safety" },
  pdf: {
    disclaimer:
      "Data-informed suggestions from public data (U.S. DOE College Scorecard) — not a guarantee of admission or aid. Verify current figures with each college.",
    generatedPrefix: "Generated",
  },
  // --- Split-view UI copy -----------------------------------------------------
  ui: {
    appTagline: "Describe a student, build their list.",
    inputPlaceholder: "Describe the student — grades, scores, interests, constraints…",
    sendLabel: "Send",
    downloadLabel: "Download PDF",
    thinkingLabel: "Thinking…",
    retryLabel: "Retry",
    // Fallbacks when the server gives no specific message, or the request never reached it.
    errorGeneric: "Something went wrong. Please try again.",
    errorNetwork: "Couldn't reach the server. Check your connection and try again.",
    emptyHeading: "No list yet",
    emptySubtext:
      "Tell the assistant about a student on the left, or start from an example below. The college list will build here.",
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
  },
  // Original synthetic starter prompts (illustrative students, not real people).
  examples: [
    {
      label: "STEM student, top scores, wants a big research university",
      prompt:
        "I'm working with Priya, a junior with a 3.9 GPA and a 1520 SAT. She's set on computer science and robotics, wants a large university with strong research and internship pipelines, and is open to going anywhere in the country.",
    },
    {
      label: "Marine biology, solid grades, needs financial aid",
      prompt:
        "Marcus has a 3.4 GPA and took the ACT once, scoring 27. He's passionate about marine biology and wants hands-on fieldwork near the coast. Money is tight, so financial aid matters a lot, and he'd prefer to stay in the South.",
    },
    {
      label: "Undecided arts student, small warm-climate campus",
      prompt:
        "Elena is a 3.6 GPA junior, test-optional, still undecided but leaning toward the arts and design. She wants a small, close-knit campus in a warm climate and doesn't want to be more than a few hours from home in California.",
    },
  ],
} as const;
