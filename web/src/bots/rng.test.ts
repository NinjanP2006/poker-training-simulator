import { describe, expect, it } from "vitest";
import { seededRandom } from "./rng";

describe("seededRandom", () => {
  it("is fixed by seed, position in the hand, and seat", () => {
    expect(seededRandom("42", 7, 3)).toBe(seededRandom("42", 7, 3));
    expect(seededRandom("42", 7, 3)).not.toBe(seededRandom("42", 8, 3));
    expect(seededRandom("42", 7, 3)).not.toBe(seededRandom("43", 7, 3));
    expect(seededRandom("42", 7, 3)).not.toBe(seededRandom("42", 7, 4));
  });

  it("spreads evenly over [0, 1)", () => {
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 20_000; i++) {
      const r = seededRandom("seed", i, 0);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
      buckets[Math.floor(r * 10)]++;
    }
    for (const count of buckets) {
      expect(count).toBeGreaterThan(1_800);
      expect(count).toBeLessThan(2_200);
    }
  });
});
