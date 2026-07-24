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
} as const;
