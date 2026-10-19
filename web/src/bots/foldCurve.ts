// Fold curves for the decision analysis: how often an opponent's current
// range folds to a bet, at each price, according to the opponent model. This
// replaces the analysis's placeholder fold frequency.

import { COMBOS, comboUsesAny } from "../core/combos";
import type { Card, HandView, TableConfig } from "../core/types";
import { positionOf } from "./positions";
import { type Model, rawProbs, type Situation } from "./model";

/** Prices (pot odds offered to the opponent) the curve is sampled at. */
export const CURVE_POINTS = [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5];

/**
 * [pot odds, fold frequency] points for `seat` facing a bet or raise from
 * hero now. `known` are cards hero can see (their hole cards and the board),
 * which the opponent can't hold.
 */
export function foldCurve(
  model: Model,
  range: Float32Array,
  seat: number,
  view: HandView,
  config: TableConfig,
  strengths: Float32Array | null,
  known: Card[],
): [number, number][] {
  return CURVE_POINTS.map((potOdds) => {
    const situation: Situation =
      view.street === "preflop"
        ? {
            street: "preflop",
            // Hero raising makes it one more raise than now.
            spot: view.raisesThisStreet >= 1 ? "vs3bet" : "vsRaise",
            position: positionOf(seat, config),
            headsUp: config.seats.length === 2,
            potOdds,
          }
        : { street: "postflop", facingBet: true, potOdds };
    let folds = 0;
    let total = 0;
    for (let c = 0; c < COMBOS; c++) {
      const w = range[c];
      if (w === 0 || comboUsesAny(c, known)) continue;
      folds += w * rawProbs(model, situation, c, strengths).fold;
      total += w;
    }
    return [potOdds, total > 0 ? folds / total : 0];
  });
}
