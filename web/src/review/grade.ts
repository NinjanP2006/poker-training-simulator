// Grading a decision: how much estimated EV the chosen action gave up
// against the best action, and what kind of mistake it was.

import type { Action, ActionEv, DecisionAnalysis, DecisionLabel, MistakeCategory } from "../core/types";
import { sameAction } from "../explain/format";

/** EV lost thresholds from the plan, in big blinds. */
export const FINE_BELOW_BB = 0.25;
export const MISTAKE_ABOVE_BB = 1;

export type Grade = {
  chosen: ActionEv;
  best: ActionEv;
  /** Estimated EV given up, in big blinds (0 if the best action was chosen). */
  evLostBb: number;
  label: DecisionLabel;
  category?: MistakeCategory;
};

const isAggressive = (a: Action) => a.kind === "bet" || a.kind === "raise" || a.kind === "allIn";

export function labelFor(evLostBb: number): DecisionLabel {
  if (evLostBb < FINE_BELOW_BB) return "fine";
  if (evLostBb <= MISTAKE_ABOVE_BB) return "marginal";
  return "mistake";
}

/**
 * Grades `chosen` against the analysis made before it. The chosen action
 * must be one of the analysed actions (the app re-analyses with the exact
 * size when needed).
 */
export function grade(analysis: DecisionAnalysis, chosen: Action, bigBlind: number): Grade {
  const chosenEv = analysis.evByAction.find((x) => sameAction(x.action, chosen));
  if (!chosenEv) throw new Error("the chosen action wasn't analysed");
  const best = analysis.evByAction.reduce((a, b) => (b.ev > a.ev ? b : a));
  const evLostBb = Math.max(0, (best.ev - chosenEv.ev) / bigBlind);
  const label = labelFor(evLostBb);
  return { chosen: chosenEv, best, evLostBb, label, category: label === "fine" ? undefined : categorize(chosen, best.action) };
}

/** What kind of error it was, for the stats screen. */
function categorize(chosen: Action, best: Action): MistakeCategory {
  if (chosen.kind === "fold") return "overfolding"; // folded when continuing was better
  if (isAggressive(best)) return isAggressive(chosen) ? "sizing" : "missedValue"; // wrong size, or checked/called instead
  if (best.kind === "fold") return "callingWide"; // called (or raised) when folding was better
  return "sizing"; // bet or raised when checking or calling was better
}
