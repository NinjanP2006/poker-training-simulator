import { describe, expect, it } from "vitest";
import type { DecisionRow, SessionRow } from "../storage/db";
import { PRESETS } from "../state/session";
import { computeStats } from "./stats";

const session = (id: string, startedAt: number): SessionRow => ({
  id,
  startedAt,
  settings: PRESETS[0].settings,
  coachMode: "always",
  revealStyles: false,
});

const decision = (sessionId: string, label: DecisionRow["label"], evLostBb: number, category?: DecisionRow["category"]): DecisionRow => ({
  handId: "h",
  sessionId,
  playedAt: 0,
  street: "flop",
  label,
  evLostBb,
  category,
});

describe("stats", () => {
  const sessions = [session("s2", 2000), session("s1", 1000)];
  const decisions = [
    decision("s1", "mistake", 3, "callingWide"),
    decision("s1", "mistake", 2, "overfolding"),
    decision("s1", "marginal", 0.5, "callingWide"),
    decision("s1", "fine", 0),
    decision("s2", "mistake", 1.5, "sizing"),
    decision("s2", "fine", 0.1),
  ];
  const handCounts = new Map([
    ["s1", 20],
    ["s2", 50],
  ]);

  it("totals decisions, mistakes per 100 hands and EV lost", () => {
    const s = computeStats(decisions, sessions, handCounts);
    expect(s.hands).toBe(70);
    expect(s.decisions).toBe(6);
    expect(s.labels).toEqual({ fine: 2, marginal: 1, mistake: 3 });
    expect(s.mistakesPer100).toBeCloseTo((3 / 70) * 100);
    expect(s.evLostBb).toBeCloseTo(7.1);
    expect(s.evLostPer100).toBeCloseTo((7.1 / 70) * 100);
  });

  it("adds up EV lost by mistake category", () => {
    const s = computeStats(decisions, sessions, handCounts);
    expect(s.byCategory.callingWide).toEqual({ count: 2, evLostBb: 3.5 });
    expect(s.byCategory.overfolding).toEqual({ count: 1, evLostBb: 2 });
    expect(s.byCategory.sizing).toEqual({ count: 1, evLostBb: 1.5 });
    expect(s.byCategory.missedValue).toEqual({ count: 0, evLostBb: 0 });
  });

  it("gives a per-session trend, oldest session first", () => {
    const s = computeStats(decisions, sessions, handCounts);
    expect(s.sessions.map((x) => [x.sessionId, x.hands, x.mistakes, x.mistakesPer100])).toEqual([
      ["s1", 20, 2, 10],
      ["s2", 50, 1, 2],
    ]);
  });

  it("can be limited to one session", () => {
    const s = computeStats(decisions, sessions, handCounts, "s2");
    expect(s.hands).toBe(50);
    expect(s.decisions).toBe(2);
    expect(s.sessions.map((x) => x.sessionId)).toEqual(["s2"]);
  });

  it("is all zeros with no play", () => {
    const s = computeStats([], [], new Map());
    expect([s.hands, s.mistakesPer100, s.evLostPer100]).toEqual([0, 0, 0]);
  });
});
