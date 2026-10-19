// Plain-language explanations, built from templates rather than an LLM, so
// they're instant, free, deterministic and testable.

import type { ActionEv, DecisionAnalysis } from "../core/types";
import type { Grade } from "../review/grade";
import { actionLabel, actionPastTense, bb, pct } from "./format";

export type Explanation = {
  /** One line: the best action and why, in brief. */
  headline: string;
  /** Supporting points, most important first. */
  points: string[];
};

export const ESTIMATE_NOTE =
  "EVs are estimates: they count this street only, assume a showdown after it, and use ranges inferred from how the opponents have played this hand.";

const isAggressive = (x: ActionEv) => x.action.kind === "bet" || x.action.kind === "raise" || x.action.kind === "allIn";

export function bestAction(a: DecisionAnalysis): ActionEv {
  return a.evByAction.reduce((x, y) => (y.ev > x.ev ? y : x));
}

/** The explanation shown with the math panel for the current decision. */
export function explainDecision(a: DecisionAnalysis, bigBlind: number): Explanation {
  const best = bestAction(a);
  const e = a.equity.equity;
  const facingBet = a.toCall > 0;
  const points: string[] = [];

  // 1. The price, or the situation when nobody has bet.
  if (facingBet) {
    if (e >= a.potOdds) {
      points.push(`You need ${pct(a.potOdds)} equity to call and have about ${pct(e)}, so calling pays on its own.`);
    } else {
      let text = `You need ${pct(a.potOdds)} equity to call and have about ${pct(e)}.`;
      if (a.impliedOddsNeeded !== null && a.impliedOddsNeeded > 0 && a.street !== "river") {
        text += ` Even counting future streets, you'd need to win ${bb(a.impliedOddsNeeded, bigBlind)} more when you hit.`;
      }
      points.push(text);
    }
  } else {
    const who = a.opponents === 1 ? "your opponent's" : `${a.opponents} opponents'`;
    points.push(`Nobody has bet. Your equity is about ${pct(e)} against ${who} estimated range.`);
  }

  // 2. Outs.
  if (a.outs) {
    const o = a.outs;
    const n = o.clean.length + o.dirty.length;
    const flop = o.byRiver !== null;
    let text = n === 0 ? "You have no outs that put you ahead." : `You have ${n} out${n === 1 ? "" : "s"}`;
    if (n > 0) {
      if (o.dirty.length) text += ` (${o.dirty.length} dirty: they improve you, but still leave some of their hands ahead)`;
      text += `: ${pct(o.nextCard)} to hit on the next card`;
      if (flop) text += `, ${pct(o.byRiver!)} by the river`;
      text += `. The Rule of ${flop ? 4 : 2} says ${pct(o.ruleOfThumb)}.`;
      if (flop && n > 12) text += " With this many outs the shortcut overstates your chances.";
    }
    points.push(text);
  }

  // 3. The best bet or raise, if one is best.
  if (isAggressive(best) && best.foldFrequency !== null && best.breakEvenFold !== null) {
    let text = `${actionLabel(best.action, bigBlind)} should win the pot right away about ${pct(best.foldFrequency)} of the time; a pure bluff that size needs ${pct(best.breakEvenFold)}.`;
    if (best.equityWhenCalled !== null && best.foldFrequency < 0.999) {
      text += ` When called, you have about ${pct(best.equityWhenCalled)} against the hands that continue.`;
    }
    points.push(text);
  }

  // 4. Defense frequency.
  if (facingBet && a.mdf !== null) {
    points.push(`Against this bet size, defending at least ${pct(a.mdf)} of your hands stops pure bluffs from profiting automatically.`);
  }

  // 5. Stack-to-pot ratio, when it changes the plan.
  if (a.street !== "preflop" && a.spr < 3) {
    points.push(`With a stack-to-pot ratio of ${a.spr.toFixed(1)}, strong one-pair hands are usually happy to get all-in.`);
  }

  return { headline: headline(a, best, bigBlind), points };
}

function headline(a: DecisionAnalysis, best: ActionEv, bigBlind: number): string {
  const label = actionLabel(best.action, bigBlind);
  const e = a.equity.equity;
  switch (best.action.kind) {
    case "fold":
      return `${label}. You need ${pct(a.potOdds)} equity to call and have about ${pct(e)}.`;
    case "call":
      return `${label}. Your ${pct(e)} equity beats the ${pct(a.potOdds)} you need.`;
    case "check":
      return `${label}. Betting doesn't gain enough here to be worth the risk.`;
    default:
      return `${label}. It's the most profitable option by the estimates below.`;
  }
}

const CATEGORY_TIPS = {
  overfolding: "Your equity was enough to continue at this price.",
  callingWide: "Your equity wasn't enough for the price.",
  sizing: "The size mattered: a different amount would have done better.",
  missedValue: "Betting or raising would have earned more here.",
} as const;

/** Feedback on a decision the player just made. */
export function explainGrade(g: Grade, bigBlind: number): string {
  const did = `You ${actionPastTense(g.chosen.action, bigBlind)}`;
  if (g.label === "fine") {
    return g.evLostBb === 0 ? `${did}: the best option by the estimates.` : `${did}: fine. ${actionLabel(g.best.action, bigBlind)} was only ${g.evLostBb.toFixed(2)} BB better.`;
  }
  const tip = g.category ? ` ${CATEGORY_TIPS[g.category]}` : "";
  return `${did}: ${g.label === "mistake" ? "a mistake" : "marginal"}. ${actionLabel(g.best.action, bigBlind)} was worth about ${g.evLostBb.toFixed(2)} BB more (estimated).${tip}`;
}
