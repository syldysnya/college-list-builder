/**
 * `POST /api/pdf` — render a client-held `CollegeList` to a downloadable PDF.
 *
 * The list arrives from the browser, so it is untrusted: every school id is
 * verified against `loadColleges()` before rendering, so the PDF can only ever
 * contain real, dataset-backed schools (never arbitrary client-injected
 * content). The student name is the one field taken verbatim from the client
 * (it never went server-side during chat) and overrides the list's own name.
 */
import { loadColleges } from "@/lib/dataset";
import { renderListToBuffer } from "@/lib/pdf";
import { CollegeList, TIERS, type ScoredCollege } from "@/lib/types";
import { z } from "zod";

// --- Error messages (named — no magic strings) -------------------------------
const ERR_INVALID_JSON = "Invalid JSON body.";
const ERR_INVALID_BODY = "Invalid request body.";
const ERR_UNKNOWN_SCHOOL = "unknown school";

// --- HTTP ---------------------------------------------------------------------
const STATUS_BAD_REQUEST = 400;
const JSON_HEADERS = { "Content-Type": "application/json" } as const;
const PDF_FILENAME = "college-list.pdf";
const PDF_HEADERS = {
  "Content-Type": "application/pdf",
  "Content-Disposition": `attachment; filename="${PDF_FILENAME}"`,
} as const;

/**
 * Request body: a `CollegeList` plus an optional `studentName` override (the
 * real name the client kept out of the server during chat).
 */
const PdfRequest = z.object({
  list: CollegeList,
  studentName: z.string().optional(),
});

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: JSON_HEADERS });
}

/** Every college id referenced across the list's three tiers. */
function collectIds(list: z.infer<typeof CollegeList>): string[] {
  return TIERS.flatMap((tier) => list[tier].map((sc: ScoredCollege) => sc.college.id));
}

export async function POST(req: Request): Promise<Response> {
  // 1. Parse + validate.
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError(ERR_INVALID_JSON, STATUS_BAD_REQUEST);
  }

  const parsed = PdfRequest.safeParse(raw);
  if (!parsed.success) {
    return jsonError(ERR_INVALID_BODY, STATUS_BAD_REQUEST);
  }
  const { list, studentName } = parsed.data;

  // 2. Integrity: every school id must exist in the dataset.
  const known = new Set(loadColleges().map((c) => c.id));
  if (collectIds(list).some((id) => !known.has(id))) {
    return jsonError(ERR_UNKNOWN_SCHOOL, STATUS_BAD_REQUEST);
  }

  // 3. Override the name with the client's verbatim value when provided.
  const finalList =
    studentName !== undefined ? { ...list, studentName } : list;

  // 4. Render.
  const buffer = await renderListToBuffer(finalList);
  return new Response(new Uint8Array(buffer), { headers: PDF_HEADERS });
}
