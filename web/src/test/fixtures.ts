// Hand-built analyses for unit and component tests.

import type { ActionEv, DecisionAnalysis } from "../core/types";

const passive = (action: ActionEv["action"], ev: number): ActionEv => ({
  action,
  ev,
  foldFrequency: null,
  breakEvenFold: null,
  equityWhenCalled: null,
});

/** The plan's example: facing a bet, needing 25% equity with about 18%. */
export function facingBetAnalysis(overrides: Partial<DecisionAnalysis> = {}): DecisionAnalysis {
  return {
    street: "flop",
    hero: 0,
    opponents: 1,
    pot: 150,
    toCall: 50,
    effectiveStack: 900,
    equity: { equity: 0.18, win: 0.17, tie: 0.02, stdErr: null, method: "exact", evaluations: 120_000, liveCombos: 150 },
    potOdds: 0.25,
    mdf: 2 / 3,
    spr: 6,
    impliedOddsNeeded: 120,
    outs: {
      clean: [6, 10, 14, 18, 26, 30, 34, 38], // eight hearts
      dirty: [2],
      unseen: 47,
      nextCard: 9 / 47,
      byRiver: 1 - 703 / 1081,
      ruleOfThumb: 0.36,
    },
    evByAction: [
      passive({ kind: "fold" }, 0),
      passive({ kind: "call" }, -14),
      { action: { kind: "raise", to: 200 }, ev: -30, foldFrequency: 0.3, breakEvenFold: 0.5, equityWhenCalled: 0.12 },
      { action: { kind: "allIn" }, ev: -90, foldFrequency: 0.5, breakEvenFold: 0.86, equityWhenCalled: 0.1 },
    ],
    ...overrides,
  };
}

/** Checked to hero with a strong hand: betting is best. */
export function checkedToAnalysis(overrides: Partial<DecisionAnalysis> = {}): DecisionAnalysis {
  return {
    street: "turn",
    hero: 0,
    opponents: 1,
    pot: 40,
    toCall: 0,
    effectiveStack: 60,
    equity: { equity: 0.78, win: 0.77, tie: 0.02, stdErr: null, method: "exact", evaluations: 9_000, liveCombos: 80 },
    potOdds: 0,
    mdf: null,
    spr: 1.5,
    impliedOddsNeeded: null,
    outs: null,
    evByAction: [
      passive({ kind: "check" }, 31.2),
      { action: { kind: "bet", amount: 26 }, ev: 36.4, foldFrequency: 0.35, breakEvenFold: 0.39, equityWhenCalled: 0.66 },
      { action: { kind: "allIn" }, ev: 34, foldFrequency: 0.5, breakEvenFold: 0.6, equityWhenCalled: 0.55 },
    ],
    ...overrides,
  };
}
