import { describe, expect, it } from "vitest";
import type { HandEvent, HandHistory } from "../core/types";
import { facingBetAnalysis } from "../test/fixtures";
import { replaySteps } from "./replay";

const events: HandEvent[] = [
  { t: "blind", seat: 1, amount: 1 },
  { t: "blind", seat: 0, amount: 2 },
  { t: "deal", seat: 0, cards: [0, 1] },
  { t: "deal", seat: 1, cards: [2, 3] },
  { t: "act", seat: 1, action: { kind: "call" } }, // 4
  { t: "act", seat: 0, action: { kind: "check" } }, // 5: hero's decision came before this
  { t: "board", cards: [10, 20, 30] }, // 6
  { t: "act", seat: 0, action: { kind: "bet", amount: 4 } }, // 7
  { t: "act", seat: 1, action: { kind: "fold" } }, // 8
  { t: "award", potIndex: 0, seat: 0, amount: 4 }, // 9
];

const hand = (eventIndexes: number[]): HandHistory => ({
  id: "h",
  sessionId: "s",
  number: 1,
  playedAt: 0,
  seed: "1",
  config: { seats: [], smallBlind: 1, bigBlind: 2, button: 1 },
  events,
  heroSeat: 0,
  netBb: 1,
  revealStyles: false,
  analyses: eventIndexes.map((eventIndex) => ({ ...facingBetAnalysis(), chosen: { kind: "check" }, evLost: 0, label: "fine", eventIndex })),
});

describe("replay steps", () => {
  it("stops after the deal, after each action and board card, and at the end", () => {
    expect(replaySteps(hand([])).map((s) => s.events)).toEqual([4, 5, 6, 7, 8, 9, 10]);
  });

  it("links the steps where the player decides", () => {
    const steps = replaySteps(hand([5, 7]));
    expect(steps.filter((s) => s.decision !== null).map((s) => [s.events, s.decision])).toEqual([
      [5, 0],
      [7, 1],
    ]);
  });
});
