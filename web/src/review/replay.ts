// Replay steps for a saved hand: the points worth stopping at.

import type { HandHistory } from "../core/types";

export type ReplayStep = {
  /** Show the hand after this many events. */
  events: number;
  /** Index into hand.analyses if the player decides at this step. */
  decision: number | null;
};

/**
 * One step once the cards are dealt, one after every action and every board
 * card, and a final step with the pots awarded. A step where the player is
 * about to act links to that decision.
 */
export function replaySteps(hand: HandHistory): ReplayStep[] {
  const { events, analyses } = hand;
  const lastDeal = events.reduce((last, e, i) => (e.t === "deal" ? i : last), -1);
  const cuts = new Set<number>([lastDeal + 1, events.length]);
  events.forEach((e, i) => {
    if (e.t === "act" || e.t === "board") cuts.add(i + 1);
  });
  return [...cuts]
    .sort((a, b) => a - b)
    .map((n) => {
      const decision = analyses.findIndex((d) => d.eventIndex === n);
      return { events: n, decision: decision >= 0 ? decision : null };
    });
}
