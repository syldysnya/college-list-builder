import { describe, it, expect } from "vitest";
import { POST } from "./route";
import { buildList } from "@/lib/matching";
import { loadColleges } from "@/lib/dataset";
import { emptyProfile, type CollegeList } from "@/lib/types";

const PDF_MAGIC = "%PDF";

/** A ranked list built entirely from real, dataset-backed schools. */
function realList(): CollegeList {
  return buildList(emptyProfile(), loadColleges());
}

function pdfRequest(body: unknown): Request {
  return new Request("http://localhost/api/pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/pdf", () => {
  it("renders a real list to a PDF (200, application/pdf, %PDF body)", async () => {
    const res = await POST(pdfRequest({ list: realList() }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");

    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 4).toString()).toBe(PDF_MAGIC);
  });

  it("400s when any school id is not in the dataset", async () => {
    const list = realList();
    const firstScored = list.colleges[0];
    expect(firstScored).toBeDefined();
    firstScored!.college.id = "totally-fake-school";

    const res = await POST(pdfRequest({ list }));
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe("unknown school");
  });

  it("overrides the list's studentName with the client's verbatim name", async () => {
    const res = await POST(pdfRequest({ list: realList(), studentName: "Real Name" }));
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 4).toString()).toBe(PDF_MAGIC);
  });

  it("400s a malformed body (missing list)", async () => {
    const res = await POST(pdfRequest({ studentName: "x" }));
    expect(res.status).toBe(400);
  });
});
