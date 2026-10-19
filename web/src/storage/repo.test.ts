import "fake-indexeddb/auto"; // an in-memory IndexedDB for Node
import { describe, expect, it } from "vitest";
import type { HandHistory } from "../core/types";
import { PRESETS } from "../state/session";
import { checkedToAnalysis, facingBetAnalysis } from "../test/fixtures";
import { TrainerDb } from "./db";
import { createRepository } from "./repo";

const freshRepo = () => createRepository(new TrainerDb(`test-${crypto.randomUUID()}`));

function hand(sessionId: string, playedAt: number, overrides: Partial<HandHistory> = {}): HandHistory {
  return {
    id: crypto.randomUUID(),
    sessionId,
    number: 1,
    playedAt,
    seed: "42",
    config: { seats: [], smallBlind: 1, bigBlind: 2, button: 0 },
    events: [],
    heroSeat: 0,
    netBb: -1,
    revealStyles: false,
    analyses: [
      { ...facingBetAnalysis(), chosen: { kind: "call" }, evLost: 7, label: "mistake", category: "callingWide", eventIndex: 10 },
      { ...checkedToAnalysis(), chosen: { kind: "bet", amount: 26 }, evLost: 0, label: "fine", eventIndex: 14 },
    ],
    ...overrides,
  };
}

describe("hand repository", () => {
  it("saves a hand and its decisions together, and reads them back", async () => {
    const repo = freshRepo();
    const session = await repo.startSession(PRESETS[0].settings, "always", false);
    const h = hand(session, 1000);
    await repo.saveHand(h);

    expect(await repo.getHand(h.id)).toEqual(h);
    const decisions = await repo.listDecisions();
    expect(decisions.map((d) => [d.label, d.evLostBb, d.category])).toEqual([
      ["mistake", 7, "callingWide"],
      ["fine", 0, undefined],
    ]);
    expect(decisions.every((d) => d.handId === h.id && d.sessionId === session)).toBe(true);
  });

  it("lists hands newest first and counts them per session", async () => {
    const repo = freshRepo();
    const a = await repo.startSession(PRESETS[0].settings, "always", false);
    const b = await repo.startSession(PRESETS[1].settings, "off", true);
    await repo.saveHand(hand(a, 1000));
    await repo.saveHand(hand(a, 3000));
    await repo.saveHand(hand(b, 2000));

    expect((await repo.listHands()).map((h) => h.playedAt)).toEqual([3000, 2000, 1000]);
    expect(await repo.handCounts()).toEqual(new Map([[a, 2], [b, 1]]));
    expect((await repo.listSessions()).map((s) => s.coachMode)).toEqual(["always", "off"]);
  });

  it("saving the same hand again replaces its decisions instead of duplicating them", async () => {
    const repo = freshRepo();
    const session = await repo.startSession(PRESETS[0].settings, "always", false);
    const h = hand(session, 1000);
    await repo.saveHand(h);
    await repo.saveHand(h);
    expect(await repo.listDecisions()).toHaveLength(2);
  });

  it("clears everything", async () => {
    const repo = freshRepo();
    const session = await repo.startSession(PRESETS[0].settings, "always", false);
    await repo.saveHand(hand(session, 1000));
    await repo.clearAll();
    expect(await repo.listHands()).toEqual([]);
    expect(await repo.listDecisions()).toEqual([]);
    expect(await repo.listSessions()).toEqual([]);
  });
});
