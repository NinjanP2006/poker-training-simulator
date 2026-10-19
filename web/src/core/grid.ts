// The 13×13 hand grid. Rows and columns run A, K, Q … 2. Pairs sit on the
// diagonal, suited hands above it (row < column), offsuit hands below.

import { comboCards, COMBOS, comboUsesAny } from "./combos";
import { rankOf, suitOf } from "./cards";
import type { Card } from "./types";

export const GRID_RANKS = "AKQJT98765432";

export type Cell = { row: number; col: number };

/** Grid index (0 = ace … 12 = deuce) of a card's rank. */
const gridIndex = (card: Card) => 12 - rankOf(card);

export function cellOfCombo(combo: number): Cell {
  const [a, b] = comboCards(combo);
  const [ia, ib] = [gridIndex(a), gridIndex(b)];
  const [high, low] = ia < ib ? [ia, ib] : [ib, ia];
  if (high === low) return { row: high, col: high };
  return suitOf(a) === suitOf(b) ? { row: high, col: low } : { row: low, col: high };
}

/** "AKs", "AKo", "QQ". */
export function cellName({ row, col }: Cell): string {
  if (row === col) return GRID_RANKS[row] + GRID_RANKS[row];
  return row < col ? `${GRID_RANKS[row]}${GRID_RANKS[col]}s` : `${GRID_RANKS[col]}${GRID_RANKS[row]}o`;
}

/** The combos in each cell, indexed [row][col]. */
export const CELL_COMBOS: number[][][] = (() => {
  const cells = Array.from({ length: 13 }, () => Array.from({ length: 13 }, () => [] as number[]));
  for (let c = 0; c < COMBOS; c++) {
    const { row, col } = cellOfCombo(c);
    cells[row][col].push(c);
  }
  return cells;
})();

export type CellSummary = {
  name: string;
  /** Combos of this hand type (6, 4 or 12). */
  total: number;
  /** Combos still possible given the known cards (blockers). */
  live: number;
  /** Weighted live combos in the range. */
  weighted: number;
  /** Average weight of the live combos, 0–1 (0 if none are live). */
  frequency: number;
};

/** Per-cell summary of a range, after removing combos that use a known card. */
export function summarizeGrid(range: Float32Array, known: Card[]): CellSummary[][] {
  return CELL_COMBOS.map((cols, row) =>
    cols.map((combos, col) => {
      const live = combos.filter((c) => !comboUsesAny(c, known));
      const weighted = live.reduce((sum, c) => sum + range[c], 0);
      return {
        name: cellName({ row, col }),
        total: combos.length,
        live: live.length,
        weighted,
        frequency: live.length ? weighted / live.length : 0,
      };
    }),
  );
}

/** Weight steps a click cycles through: all, half, none. */
const CYCLE = [1, 0.5, 0];

/** A copy of `range` with every combo in the cell set to the next weight in the cycle. */
export function cycleCell(range: Float32Array, cell: Cell): Float32Array {
  const combos = CELL_COMBOS[cell.row][cell.col];
  const current = combos.reduce((sum, c) => sum + range[c], 0) / combos.length;
  // Go to the next step below the current average (wrapping to "all").
  const next = CYCLE.find((w) => w < current - 1e-6) ?? 1;
  const out = new Float32Array(range);
  for (const c of combos) out[c] = next;
  return out;
}
