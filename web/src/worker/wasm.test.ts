// Calls the real compiled core (src/wasm, built by `pnpm build:wasm`) to check
// that data crosses the JavaScript/WebAssembly boundary in the shapes the
// TypeScript types promise.

import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { parseCards } from "../core/cards";
import type { Action, HandView, TableConfig } from "../core/types";
import * as wasm from "../wasm/poker_wasm";

beforeAll(() => {
  // In the browser, init() fetches the file; in Node we hand over the bytes directly.
  wasm.initSync({ module: readFileSync(new URL("../wasm/poker_wasm_bg.wasm", import.meta.url)) });
  wasm.warmUp();
});

const config: TableConfig = {
  seats: [
    { player: { kind: "hero" }, stack: 100 },
    { player: { kind: "bot", profile: "tightPassive" }, stack: 100 },
  ],
  smallBlind: 1,
  bigBlind: 2,
  button: 0,
};

const act = (view: HandView, action: Action): HandView => wasm.applyAction(config, "42", view.events, action);

describe("hands across the boundary", () => {
  it("starts a hand with blinds posted and cards dealt", () => {
    const view: HandView = wasm.newHand(config, "42");
    expect(view.street).toBe("preflop");
    expect(view.pot).toBe(3);
    expect(view.toAct).toBe(0);
    expect(view.legal).toEqual({ seat: 0, toCall: 1, callIsAllIn: false, minRaiseTo: 4, maxRaiseTo: 100, isBet: false });
    expect(view.players.map((p) => p.stack)).toEqual([99, 98]);
    expect(view.players.every((p) => p.hole !== null && p.hole.length === 2)).toBe(true);
    expect(view.events[0]).toEqual({ t: "blind", seat: 0, amount: 1 });
  });

  it("applies actions by replaying the event list", () => {
    let view: HandView = wasm.newHand(config, "42");
    view = act(view, { kind: "call" });
    view = act(view, { kind: "check" });
    expect(view.street).toBe("flop");
    expect(view.board).toHaveLength(3);
    expect(view.legal?.isBet).toBe(true);
    view = act(view, { kind: "bet", amount: 10 });
    expect(view.events.at(-1)).toEqual({ t: "act", seat: 1, action: { kind: "bet", amount: 10 } });
  });

  it("finishes a hand and reports awards with null for missing values", () => {
    let view: HandView = wasm.newHand(config, "42");
    view = act(view, { kind: "fold" });
    expect(view.complete).toBe(true);
    expect(view.toAct).toBeNull(); // null, not undefined
    expect(view.legal).toBeNull();
    expect(view.events.at(-1)).toEqual({ t: "award", potIndex: 0, seat: 1, amount: 3 });
  });

  it("throws a readable error on an illegal action", () => {
    const view: HandView = wasm.newHand(config, "42");
    expect(() => act(view, { kind: "check" })).toThrow(/facing a bet/);
    expect(() => act(view, { kind: "raise", to: 3 })).toThrow(/minimum is 4/);
  });

  it("rejects a tampered event list", () => {
    const view: HandView = wasm.newHand(config, "42");
    const events = structuredClone(view.events);
    events[2] = { t: "deal", seat: 1, cards: [0, 1] };
    expect(() => wasm.viewHand(config, "42", events)).toThrow(/replay mismatch/);
  });
});

describe("ranges and equity across the boundary", () => {
  it("parses ranges into 1,326 weights and prints them back", () => {
    const range = wasm.parseRange("22+, A2s+");
    expect(range).toBeInstanceOf(Float32Array);
    expect(range).toHaveLength(1326);
    expect(range.reduce((a, b) => a + b, 0)).toBe(78 + 48);
    expect(wasm.rangeToNotation(range)).toBe("22+, A2s+");
    expect(() => wasm.parseRange("AKx")).toThrow(/can't parse/);
  });

  it("computes exact and Monte Carlo equity", () => {
    const hero = Uint8Array.from(parseCards("As Ad"));
    const kings = wasm.parseRange("KK");
    const river = Uint8Array.from(parseCards("2c 7d 9h 4s 3c"));
    const none = new Uint8Array();

    const exact = wasm.equity(hero, kings, river, none, undefined);
    expect(exact).toMatchObject({ equity: 1, method: "exact", stdErr: null, liveCombos: 6 });

    const preflop = wasm.equity(hero, kings, none, none, { maxSamples: 5000, maxStdErr: 0, budgetMs: 1e9 });
    expect(preflop.method).toBe("montecarlo");
    expect(preflop.equity).toBeGreaterThan(0.75);
    expect(preflop.equity).toBeLessThan(0.88);
    expect(preflop.stdErr).toBeGreaterThan(0);
  });

  it("evaluates hands", () => {
    const quads = wasm.evaluate(Uint8Array.from(parseCards("As Ad Ah Ac 2s")));
    const fullHouse = wasm.evaluate(Uint8Array.from(parseCards("Ks Kd Kh 2c 2s")));
    expect(quads).toBeGreaterThan(fullHouse);
    expect(() => wasm.evaluate(Uint8Array.from(parseCards("As Ad")))).toThrow();
  });
});
