// The game store driving real hands through the compiled core (no worker,
// no bot delay).

import "fake-indexeddb/auto"; // an in-memory IndexedDB for Node
import { describe, expect, it } from "vitest";
import { COMBOS } from "../core/combos";
import { TrainerDb } from "../storage/db";
import { createRepository } from "../storage/repo";
import { wasmCore } from "../test/wasmCore";
import { HERO, PRESETS } from "./session";
import { createGameStore, type GameStore } from "./store";

async function waitUntil(check: () => boolean, what: string, timeoutMs = 20_000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Waits until the hand is over, or it's the player's turn with the analysis ready. */
async function nextStop(store: GameStore) {
  await waitUntil(() => {
    const s = store.getState();
    if (s.error) throw new Error(s.error);
    const v = s.hand?.view;
    return !!v && (v.complete || (v.legal?.seat === HERO && s.analysis.status === "ready" && !s.busy));
  }, "the player's turn or the end of the hand");
}

/** Plays the player's turns by checking or calling until the hand ends. */
async function playPassively(store: GameStore) {
  for (let i = 0; i < 50; i++) {
    await nextStop(store);
    const view = store.getState().hand!.view;
    if (view.complete) return;
    await store.getState().heroAct(view.legal!.toCall > 0 ? { kind: "call" } : { kind: "check" });
  }
  throw new Error("hand never finished");
}

const newStore = () => createGameStore({ core: wasmCore(), botDelayMs: 0 });

describe("game store", () => {
  it("plays complete 6-max hands against the bots, grading every decision", async () => {
    const store = newStore();
    await store.getState().startSession(PRESETS[0].settings);
    expect(store.getState().screen).toBe("play");

    for (let n = 1; n <= 3; n++) {
      const heroActsBefore = () => store.getState().hand!.view.events.filter((e) => e.t === "act" && e.seat === HERO).length;
      await playPassively(store);
      const s = store.getState();
      expect(s.hand!.view.complete).toBe(true);
      expect(s.hand!.number).toBe(n);
      expect(s.decisions).toHaveLength(heroActsBefore());
      for (const d of s.decisions) {
        expect(["fine", "marginal", "mistake"]).toContain(d.grade.label);
        expect(d.grade.evLostBb).toBeGreaterThanOrEqual(0);
      }
      const button = s.hand!.config.button;
      await s.dealNext();
      expect(store.getState().hand!.config.button).toBe((button + 1) % 6); // button moves each hand
    }
  }, 60_000);

  it("grades a custom raise size exactly, by analysing that size", async () => {
    const store = newStore();
    await store.getState().startSession(PRESETS[1].settings); // heads-up
    for (let tries = 0; tries < 20; tries++) {
      await nextStop(store);
      const s = store.getState();
      const legal = s.hand!.view.legal;
      if (!s.hand!.view.complete && legal?.minRaiseTo && legal.minRaiseTo + 1 < legal.maxRaiseTo) {
        const action = legal.isBet ? { kind: "bet" as const, amount: legal.minRaiseTo + 1 } : { kind: "raise" as const, to: legal.minRaiseTo + 1 };
        await s.heroAct(action);
        expect(store.getState().lastReview!.chosen).toEqual(action);
        expect(store.getState().lastReview!.grade.chosen.action).toEqual(action);
        return;
      }
      if (s.hand!.view.complete) await s.dealNext();
      else await s.heroAct(legal!.toCall > 0 ? { kind: "call" } : { kind: "check" });
    }
    throw new Error("never got a chance to raise");
  }, 60_000);

  it("uses a range the player edited on the grid", async () => {
    const store = newStore();
    await store.getState().startSession(PRESETS[1].settings);
    for (let tries = 0; tries < 20; tries++) {
      await nextStop(store);
      if (!store.getState().hand!.view.complete) break;
      await store.getState().dealNext();
    }
    const aces = await wasmCore().parseRange("AA");
    const before = store.getState().analysis.analysis!.equity.equity;
    store.getState().setRangeOverride(1, aces);
    await waitUntil(() => store.getState().analysis.status === "ready" && store.getState().analysis.ranges![1] === aces, "re-analysis");
    const after = store.getState().analysis.analysis!;
    expect(after.equity.equity).not.toBe(before);
    expect(after.equity.liveCombos).toBeLessThanOrEqual(6);
    expect(aces.length).toBe(COMBOS);
  }, 60_000);

  it("saves each finished hand, and a saved hand replays exactly as it was played", async () => {
    const repo = createRepository(new TrainerDb(`test-${crypto.randomUUID()}`));
    const store = createGameStore({ core: wasmCore(), repo, botDelayMs: 0 });
    await store.getState().startSession(PRESETS[0].settings);
    expect(store.getState().sessionId).not.toBeNull();

    for (let n = 0; n < 3; n++) {
      await playPassively(store);
      await waitUntil(() => store.getState().savedHands === n + 1, "the hand to be saved");
      const live = store.getState().hand!;
      const liveDecisions = store.getState().decisions;
      const [saved] = await repo.listHands(1);

      expect(saved.number).toBe(live.number);
      expect(saved.events).toEqual(live.view.events);
      expect(saved.analyses.map((a) => a.chosen)).toEqual(liveDecisions.map((d) => d.chosen));
      expect(saved.analyses.map((a) => a.eventIndex)).toEqual(liveDecisions.map((d) => d.eventIndex));
      expect(saved.netBb).toBe((live.view.players[HERO].stack - live.config.seats[HERO].stack) / 2);

      // Rebuilding from the saved seed and events gives the identical final state.
      const replayed = await wasmCore().viewHand(saved.config, saved.seed, saved.events);
      expect(replayed).toEqual(live.view);

      await store.getState().dealNext();
    }
    const decisionRows = await repo.listDecisions();
    const savedAnalyses = (await repo.listHands()).reduce((n, h) => n + h.analyses.length, 0);
    expect(decisionRows).toHaveLength(savedAnalyses);
  }, 60_000);

  it("saves hands from every session, not just the first", async () => {
    // Regression: hand ids restarted with each session, so the second
    // session's hands looked already saved and were dropped.
    const repo = createRepository(new TrainerDb(`test-${crypto.randomUUID()}`));
    const store = createGameStore({ core: wasmCore(), repo, botDelayMs: 0 });
    for (let session = 0; session < 2; session++) {
      await store.getState().startSession(PRESETS[1].settings);
      for (let n = 0; n < 2; n++) {
        await playPassively(store);
        await waitUntil(() => store.getState().savedHands === session * 2 + n + 1, "the hand to be saved");
        if (n === 0) await store.getState().dealNext();
      }
      store.getState().leaveTable();
    }
    expect(await repo.listHands()).toHaveLength(4);
    expect([...(await repo.handCounts()).values()]).toEqual([2, 2]);
  }, 60_000);

  it("reports each finished hand once to the usage hook", async () => {
    const finished: { handNumber: number; decisions: number }[] = [];
    const store = createGameStore({ core: wasmCore(), botDelayMs: 0, onHandFinished: (info) => finished.push(info) });
    await store.getState().startSession(PRESETS[1].settings);
    await playPassively(store);
    await store.getState().dealNext();
    await playPassively(store);
    await waitUntil(() => finished.length === 2, "two finished hands");
    expect(finished.map((f) => f.handNumber)).toEqual([1, 2]);
  }, 60_000);

  it("keeps playing if saving fails", async () => {
    const broken = createRepository(new TrainerDb(`test-${crypto.randomUUID()}`));
    broken.saveHand = async () => {
      throw new Error("disk full");
    };
    const store = createGameStore({ core: wasmCore(), repo: broken, botDelayMs: 0 });
    await store.getState().startSession(PRESETS[1].settings);
    await playPassively(store);
    await waitUntil(() => store.getState().storageError !== null, "the storage error");
    expect(store.getState().storageError).toContain("disk full");
    await store.getState().dealNext();
    expect(store.getState().hand!.number).toBe(2);
  }, 60_000);

  it("goes back to setup when leaving the table", async () => {
    const store = newStore();
    await store.getState().startSession(PRESETS[1].settings);
    store.getState().leaveTable();
    expect(store.getState().screen).toBe("setup");
    expect(store.getState().hand).toBeNull();
  });
});
