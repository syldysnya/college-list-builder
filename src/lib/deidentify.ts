/**
 * De-identification for counselor free-form messages.
 * Framework-free: no imports from Next/React.
 *
 * Heuristic (regex + stopword list) student-name detection, plus removal of
 * common PII (emails, phone numbers, street addresses) before the message is
 * sent to the LLM. This is best-effort, not a compliance-grade PII scrubber.
 */

/** Replaces every detected occurrence of the student's name in the masked text. */
export const STUDENT_PLACEHOLDER = "«STUDENT»";

/** Replaces emails, phone numbers, and street addresses in the masked text. */
const REDACTED = "[REDACTED]";

/** Capitalized tokens/phrases that look like a name but are not one, seen in these prompts. */
const NAME_STOPWORDS = new Set(
  [
    // US state names
    "Alabama",
    "Alaska",
    "Arizona",
    "Arkansas",
    "California",
    "Colorado",
    "Connecticut",
    "Delaware",
    "Florida",
    "Georgia",
    "Hawaii",
    "Idaho",
    "Illinois",
    "Indiana",
    "Iowa",
    "Kansas",
    "Kentucky",
    "Louisiana",
    "Maine",
    "Maryland",
    "Massachusetts",
    "Michigan",
    "Minnesota",
    "Mississippi",
    "Missouri",
    "Montana",
    "Nebraska",
    "Nevada",
    "New Hampshire",
    "New Jersey",
    "New Mexico",
    "New York",
    "North Carolina",
    "North Dakota",
    "Ohio",
    "Oklahoma",
    "Oregon",
    "Pennsylvania",
    "Rhode Island",
    "South Carolina",
    "South Dakota",
    "Tennessee",
    "Texas",
    "Utah",
    "Vermont",
    "Virginia",
    "Washington",
    "West Virginia",
    "Wisconsin",
    "Wyoming",
    // Month names
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
    // Academic / test terms that appear capitalized in these prompts
    "SAT",
    "ACT",
    "AP",
    "Calc",
    "GPA",
    "Comp Sci",
    "Congressional App Challenge",
    "National Merit",
    "Human Geo",
  ].map((word) => word.toLowerCase()),
);

/** Cue words that precede a student's name, e.g. "a student named John Smith". */
const NAME_CUE_PATTERN = /\b(?:named|student|kid)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/;

/** Fallback: the first capitalized bigram in the text, used if no cue match is found. */
const CAPITALIZED_BIGRAM_PATTERN = /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g;

const EMAIL_PATTERN = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;

/** Reasonable US-ish phone pattern: optional country code, common separators. */
const PHONE_PATTERN = /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;

const STREET_ADDRESS_PATTERN =
  /\b\d+\s+[A-Z][a-z]+\s+(?:Street|St|Ave|Avenue|Road|Rd|Blvd|Lane|Ln|Drive|Dr)\b\.?/g;

export interface DeidResult {
  masked: string; // input with PII removed/replaced
  name: string | null; // the detected student name (kept for the PDF header on the client)
}

/** True if `candidate` is a known non-name capitalized phrase (case-insensitive). */
function isStopwordPhrase(candidate: string): boolean {
  return NAME_STOPWORDS.has(candidate.toLowerCase());
}

/**
 * Detects the student's name in `text` using, in order:
 *  1. A cue-based match (after "named" / "student" / "kid").
 *  2. The first capitalized bigram that isn't a known stopword phrase.
 * Returns null if neither heuristic finds a name.
 */
function detectName(text: string): string | null {
  const cueMatch = NAME_CUE_PATTERN.exec(text);
  if (cueMatch?.[1] !== undefined) {
    return cueMatch[1];
  }

  for (const bigram of text.matchAll(CAPITALIZED_BIGRAM_PATTERN)) {
    const candidate = bigram[0];
    if (!isStopwordPhrase(candidate)) {
      return candidate;
    }
  }

  return null;
}

/** Escapes regex metacharacters so `value` can be embedded in a RegExp literal. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Detect + mask PII in a counselor message:
 *  - the student's name → STUDENT_PLACEHOLDER (all occurrences)
 *  - emails, phone numbers, street addresses → removed/redacted
 * Returns the masked text and the detected name (or null if none found).
 * The raw name must NOT appear in `masked`.
 */
export function maskPII(text: string): DeidResult {
  const name = detectName(text);

  let masked = text;
  if (name !== null) {
    const namePattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, "gi");
    masked = masked.replace(namePattern, STUDENT_PLACEHOLDER);
  }

  masked = masked
    .replace(EMAIL_PATTERN, REDACTED)
    .replace(STREET_ADDRESS_PATTERN, REDACTED)
    .replace(PHONE_PATTERN, REDACTED);

  return { masked, name };
}
