import { describe, expect, it } from "vitest";
import { wasmCore } from "../test/wasmCore";
import { parseCards } from "./cards";
import { comboIndex, COMBOS } from "./combos";
import { CELL_COMBOS, cellName, cellOfCombo, cycleCell, summarizeGrid } from "./grid";

const combo = (hand: string) => {
  const [a, b] = parseCards(hand);
  return comboIndex(a, b);
};

describe("hand grid", () => {
  it("puts pairs on the diagonal, suited above, offsuit below", () => {
    expect(cellOfCombo(combo("As Ad"))).toEqual({ row: 0, col: 0 });
    expect(cellOfCombo(combo("As Ks"))).toEqual({ row: 0, col: 1 });
    expect(cellOfCombo(combo("As Kd"))).toEqual({ row: 1, col: 0 });
    expect(cellOfCombo(combo("3c 2d"))).toEqual({ row: 12, col: 11 });
    expect(cellName({ row: 0, col: 1 })).toBe("AKs");
    expect(cellName({ row: 1, col: 0 })).toBe("AKo");
    expect(cellName({ row: 4, col: 4 })).toBe("TT");
  });

  it("holds every combo exactly once: 6 per pair, 4 per suited, 12 per offsuit hand", () => {
    let total = 0;
    CELL_COMBOS.forEach((cols, row) =>
      cols.forEach((combos, col) => {
        expect(combos.length).toBe(row === col ? 6 : row < col ? 4 : 12);
        total += combos.length;
      }),
    );
    expect(total).toBe(COMBOS);
  });

  it("matches the Rust parser's idea of each hand type", async () => {
    const weights = await wasmCore().parseRange("AKs");
    const fromRust = weights.reduce<number[]>((acc, w, i) => (w ? [...acc, i] : acc), []);
    expect([...CELL_COMBOS[0][1]].sort((a, b) => a - b)).toEqual(fromRust);
  });

  it("counts live combos after blockers", () => {
    // Holding the ace of spades on a king-high board: AA keeps 3 combos, AKo 6 (3 aces × 3 kings minus suited ones).
    const range = new Float32Array(COMBOS).fill(1);
    const grid = summarizeGrid(range, parseCards("As Kh 7c 2d"));
    expect(grid[0][0]).toMatchObject({ name: "AA", total: 6, live: 3 });
    expect(grid[0][1].live + grid[1][0].live).toBe(9); // all AK: 3 aces × 3 kings
    expect(grid[0][0].frequency).toBe(1);
  });

  it("cycles a cell through all, half and none", () => {
    let range: Float32Array = new Float32Array(COMBOS).fill(1);
    const cell = { row: 0, col: 1 };
    range = cycleCell(range, cell);
    expect(CELL_COMBOS[0][1].map((c) => range[c])).toEqual([0.5, 0.5, 0.5, 0.5]);
    range = cycleCell(range, cell);
    expect(CELL_COMBOS[0][1].every((c) => range[c] === 0)).toBe(true);
    range = cycleCell(range, cell);
    expect(CELL_COMBOS[0][1].every((c) => range[c] === 1)).toBe(true);
    expect(range[combo("Ah Ad")]).toBe(1); // other cells untouched
  });
});
