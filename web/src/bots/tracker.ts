// Bayesian range narrowing. Each opponent starts with every combo at weight
// 1. After each of their actions, every combo's weight is multiplied by the
// probability the model gives that action with that combo, so hands that
// would rarely have acted that way fade out.

import { COMBOS, comboUsesAny } from "../core/combos";
import type { Action, HandEvent, HandView, TableConfig } from "../core/types";
import type { Core } from "../worker/coreClient";
import { classify, effectiveProbs, type Model, rawProbs, situationFor, type StrengthCache } from "./model";

/**
 * The smallest multiplier an action can apply. Above zero, so a hand the
 * model thinks unlikely is weakened rather than ruled out: the model is
 * approximate (and wrong about the population when the profile is unknown).
 */
export const DEFAULT_FLOOR = 0.02;

/** Multiplies `range` (in place) by the likelihood of `action` for each combo, then rescales to a max of 1. */
export async function narrow(
  range: Float32Array,
  model: Model,
  config: TableConfig,
  before: HandView,
  seat: number,
  action: Action,
  strengths: StrengthCache,
  floor = DEFAULT_FLOOR,
): Promise<void> {
  const legal = before.legal;
  if (!legal || legal.seat !== seat) throw new Error(`seat ${seat} wasn't due to act`);
  const situation = situationFor(before, config, seat);
  const boardStrengths = situation.street === "postflop" ? await strengths.get(before.board) : null;
  const cls = classify(action, before, seat);

  let max = 0;
  for (let c = 0; c < COMBOS; c++) {
    if (range[c] === 0) continue;
    const p = effectiveProbs(rawProbs(model, situation, c, boardStrengths), legal)[cls];
    range[c] *= Math.max(p, floor);
    max = Math.max(max, range[c]);
  }
  if (max > 0) for (let c = 0; c < COMBOS; c++) range[c] /= max;
}

/**
 * Every seat's estimated range after replaying `events`, from the point of
 * view of `viewer` (whose own cards are removed from the others' ranges).
 */
export async function trackRanges(
  core: Core,
  config: TableConfig,
  seed: string,
  events: HandEvent[],
  modelFor: (seat: number) => Model,
  strengths: StrengthCache,
  options: { viewer?: number; floor?: number } = {},
): Promise<Float32Array[]> {
  const seats = config.seats.length;
  const ranges = Array.from({ length: seats }, () => new Float32Array(COMBOS).fill(1));

  // The viewer's own cards can't be in anyone else's hand.
  const deal = events.find((e) => e.t === "deal" && e.seat === options.viewer);
  if (deal?.t === "deal") {
    for (let s = 0; s < seats; s++) {
      if (s === options.viewer) continue;
      for (let c = 0; c < COMBOS; c++) if (comboUsesAny(c, deal.cards)) ranges[s][c] = 0;
    }
  }

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.t !== "act") continue;
    const before = await core.viewHand(config, seed, events.slice(0, i));
    await narrow(ranges[e.seat], modelFor(e.seat), config, before, e.seat, e.action, strengths, options.floor);
  }
  return ranges;
}

/** Total weight: the number of combos, counting partial weights. */
export function comboCount(range: Float32Array): number {
  let sum = 0;
  for (let c = 0; c < COMBOS; c++) sum += range[c];
  return sum;
}
