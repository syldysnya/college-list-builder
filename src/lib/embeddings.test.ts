import { describe, it, expect } from "vitest";
import {
  l2normalize,
  cosine,
  calibrate,
  encodeVector,
  decodeVector,
  programDocument,
  SEMANTIC_FLOOR,
  SEMANTIC_CEIL,
} from "./embeddings";

describe("l2normalize", () => {
  it("scales a vector to unit length", () => {
    const n = l2normalize(new Float32Array([3, 4]));
    expect(Math.hypot(n[0] ?? 0, n[1] ?? 0)).toBeCloseTo(1, 6);
  });
  it("leaves a zero vector unchanged (no divide-by-zero)", () => {
    const n = l2normalize(new Float32Array([0, 0]));
    expect([...n]).toEqual([0, 0]);
  });
});

describe("cosine", () => {
  it("is 1 for identical direction and 0 for orthogonal", () => {
    expect(cosine(new Float32Array([1, 0]), new Float32Array([2, 0]))).toBeCloseTo(1, 6);
    expect(cosine(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0, 6);
  });
  it("returns 0 when either vector is zero", () => {
    expect(cosine(new Float32Array([0, 0]), new Float32Array([1, 1]))).toBe(0);
  });
});

describe("calibrate", () => {
  it("maps at/below floor to 0 and at/above ceil to 1", () => {
    expect(calibrate(SEMANTIC_FLOOR)).toBe(0);
    expect(calibrate(SEMANTIC_FLOOR - 0.2)).toBe(0);
    expect(calibrate(SEMANTIC_CEIL)).toBe(1);
    expect(calibrate(SEMANTIC_CEIL + 0.2)).toBe(1);
  });
  it("maps the midpoint to 0.5", () => {
    expect(calibrate((SEMANTIC_FLOOR + SEMANTIC_CEIL) / 2)).toBeCloseTo(0.5, 6);
  });
});

describe("encodeVector / decodeVector", () => {
  it("round-trips a Float32Array exactly", () => {
    const v = new Float32Array([0.5, -0.25, 0.125, 0]);
    const back = decodeVector(encodeVector(v));
    expect([...back]).toEqual([...v]);
  });
});

describe("programDocument", () => {
  it("joins program labels with a comma and space", () => {
    expect(programDocument(["Computer Science", "Engineering"])).toBe("Computer Science, Engineering");
  });
  it("returns an empty string for no programs", () => {
    expect(programDocument([])).toBe("");
  });
});
