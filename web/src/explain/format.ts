// Formatting shared by the math panel, explanations and review.

import type { Action } from "../core/types";

/** 0.254 → "25.4%". */
export const pct = (x: number, digits = 1): string => `${(x * 100).toFixed(digits)}%`;

/** Chips → big blinds, e.g. 25 chips at a 2-chip big blind → "12.5 BB". */
export function bb(chips: number, bigBlind: number): string {
  const v = chips / bigBlind;
  const text = Number.isInteger(v) ? v.toString() : v.toFixed(1);
  return `${text} BB`;
}

/** Signed big blinds for EVs: +1.3 BB, −0.4 BB. */
export function signedBb(chips: number, bigBlind: number): string {
  const v = chips / bigBlind;
  const sign = v > 0.005 ? "+" : v < -0.005 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(2)} BB`;
}

/** "Raise to 6 BB", "Check", "All-in". */
export function actionLabel(a: Action, bigBlind: number): string {
  switch (a.kind) {
    case "bet":
      return `Bet ${bb(a.amount, bigBlind)}`;
    case "raise":
      return `Raise to ${bb(a.to, bigBlind)}`;
    case "allIn":
      return "All-in";
    case "fold":
      return "Fold";
    case "check":
      return "Check";
    case "call":
      return "Call";
  }
}

/** Same as actionLabel, but as a past-tense phrase for "you …": "raised to 6 BB". */
export function actionPastTense(a: Action, bigBlind: number): string {
  switch (a.kind) {
    case "bet":
      return `bet ${bb(a.amount, bigBlind)}`;
    case "raise":
      return `raised to ${bb(a.to, bigBlind)}`;
    case "allIn":
      return "went all-in";
    case "fold":
      return "folded";
    case "check":
      return "checked";
    case "call":
      return "called";
  }
}

export function sameAction(a: Action, b: Action): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "bet" && b.kind === "bet") return a.amount === b.amount;
  if (a.kind === "raise" && b.kind === "raise") return a.to === b.to;
  return true;
}
