import type { Card } from "./types";

// Same combo numbering as the Rust core (range.rs): a combo of two different
// cards, higher index h and lower index l, is number h·(h−1)/2 + l, filling
// 0..1325 with no gaps.

export const COMBOS = 1326;

export function comboIndex(a: Card, b: Card): number {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  if (lo === hi) throw new Error("a combo needs two different cards");
  return (hi * (hi - 1)) / 2 + lo;
}

const COMBO_CARDS: [Card, Card][] = (() => {
  const table: [Card, Card][] = new Array(COMBOS);
  for (let hi = 1; hi < 52; hi++) {
    for (let lo = 0; lo < hi; lo++) table[(hi * (hi - 1)) / 2 + lo] = [lo, hi];
  }
  return table;
})();

/** The two cards of a combo, lower index first. */
export function comboCards(index: number): [Card, Card] {
  return COMBO_CARDS[index];
}

/** True if the combo uses any of these cards. */
export function comboUsesAny(index: number, cards: Iterable<Card>): boolean {
  const [a, b] = COMBO_CARDS[index];
  for (const c of cards) if (c === a || c === b) return true;
  return false;
}
