// Stats from saved play: totals, mistakes per 100 hands, EV lost by
// category, and a per-session trend (the plan's learning metric: mistakes
// per 100 hands should fall across a player's first sessions).

import type { DecisionLabel, MistakeCategory } from "../core/types";
import type { DecisionRow, SessionRow } from "../storage/db";

export const CATEGORIES: MistakeCategory[] = ["callingWide", "overfolding", "sizing", "missedValue"];

export const CATEGORY_NAMES: Record<MistakeCategory, string> = {
  callingWide: "Calling too wide",
  overfolding: "Folding too much",
  sizing: "Bet sizing",
  missedValue: "Missed value",
};

export type SessionStats = {
  sessionId: string;
  startedAt: number;
  hands: number;
  mistakes: number;
  mistakesPer100: number;
  evLostPer100: number;
};

export type Stats = {
  hands: number;
  decisions: number;
  labels: Record<DecisionLabel, number>;
  mistakes: number;
  /** Decisions labelled "mistake" per 100 hands played. */
  mistakesPer100: number;
  evLostBb: number;
  evLostPer100: number;
  /** EV lost and count per mistake category (marginal and mistake decisions). */
  byCategory: Record<MistakeCategory, { count: number; evLostBb: number }>;
  /** Oldest first. */
  sessions: SessionStats[];
};

const per100 = (x: number, hands: number) => (hands > 0 ? (100 * x) / hands : 0);

/**
 * `handCounts` gives hands played per session. It's passed separately
 * because some hands have no decisions (everyone folds to the player's big
 * blind), yet still count toward "per 100 hands".
 */
export function computeStats(decisions: DecisionRow[], sessions: SessionRow[], handCounts: Map<string, number>, onlySession?: string): Stats {
  const rows = onlySession ? decisions.filter((d) => d.sessionId === onlySession) : decisions;
  const hands = onlySession ? (handCounts.get(onlySession) ?? 0) : [...handCounts.values()].reduce((a, b) => a + b, 0);

  const labels: Record<DecisionLabel, number> = { fine: 0, marginal: 0, mistake: 0 };
  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, { count: 0, evLostBb: 0 }])) as Stats["byCategory"];
  let evLostBb = 0;
  for (const d of rows) {
    labels[d.label]++;
    evLostBb += d.evLostBb;
    if (d.category) {
      byCategory[d.category].count++;
      byCategory[d.category].evLostBb += d.evLostBb;
    }
  }

  const sessionStats = sessions
    .filter((s) => (handCounts.get(s.id) ?? 0) > 0 && (!onlySession || s.id === onlySession))
    .map((s) => {
      const mine = decisions.filter((d) => d.sessionId === s.id);
      const n = handCounts.get(s.id) ?? 0;
      const mistakes = mine.filter((d) => d.label === "mistake").length;
      return {
        sessionId: s.id,
        startedAt: s.startedAt,
        hands: n,
        mistakes,
        mistakesPer100: per100(mistakes, n),
        evLostPer100: per100(
          mine.reduce((sum, d) => sum + d.evLostBb, 0),
          n,
        ),
      };
    })
    .sort((a, b) => a.startedAt - b.startedAt);

  return {
    hands,
    decisions: rows.length,
    labels,
    mistakes: labels.mistake,
    mistakesPer100: per100(labels.mistake, hands),
    evLostBb,
    evLostPer100: per100(evLostBb, hands),
    byCategory,
    sessions: sessionStats,
  };
}
