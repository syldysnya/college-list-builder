/**
 * College dataset loader.
 * Framework-free: no imports from Next/React.
 *
 * `src/data/colleges.json` is an approximate public-data SAMPLE (~35 real US
 * colleges, hand-curated from U.S. DOE College Scorecard-style public stats).
 * It exists to unblock the matching engine during development; it is
 * replaced by a larger, API-generated dataset (`scripts/build-dataset.ts`,
 * a separate later task).
 *
 * Validates against `College` (see `src/lib/types.ts`) once, then caches —
 * callers get a parsed, typed array on every call without re-validating.
 */
import { z } from "zod";
import { College } from "./types";
import data from "../data/colleges.json";

let cache: College[] | null = null;

export function loadColleges(): College[] {
  if (cache === null) {
    cache = z.array(College).parse(data);
  }
  return cache;
}
