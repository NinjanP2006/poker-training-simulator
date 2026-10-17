import { describe, expect, it } from "vitest";
import { wasmCore } from "../test/wasmCore";
import { parseCard } from "./cards";
import { COMBOS, comboCards, comboIndex, comboUsesAny } from "./combos";

describe("combos", () => {
  it("numbers every two-card combo 0..1325 with no gaps", () => {
    const seen = new Set<number>();
    for (let a = 0; a < 52; a++) {
      for (let b = a + 1; b < 52; b++) {
        const i = comboIndex(a, b);
        expect(comboIndex(b, a)).toBe(i);
        expect(comboCards(i)).toEqual([a, b]);
        seen.add(i);
      }
    }
    expect(seen.size).toBe(COMBOS);
    expect(Math.max(...seen)).toBe(COMBOS - 1);
  });

  it("matches the Rust core's numbering", async () => {
    const weights = await wasmCore().parseRange("AsKd");
    const index = weights.findIndex((w) => w === 1);
    expect(index).toBe(comboIndex(parseCard("As"), parseCard("Kd")));
  });

  it("detects combos that use a card", () => {
    const i = comboIndex(parseCard("As"), parseCard("Kd"));
    expect(comboUsesAny(i, [parseCard("Kd")])).toBe(true);
    expect(comboUsesAny(i, [parseCard("Kh"), parseCard("2c")])).toBe(false);
  });
});
