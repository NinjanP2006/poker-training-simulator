// Adapts the raw WebAssembly exports to the typed CoreApi. Used by the worker
// (in the browser) and by tests (in Node), so both run exactly the same code.

import type * as Wasm from "../wasm/poker_wasm";
import type { CoreApi } from "./protocol";

export function createApi(wasm: typeof Wasm): CoreApi {
  return {
    warmUp: () => wasm.warmUp(),
    newHand: (config, seed) => wasm.newHand(config, seed),
    applyAction: (config, seed, events, action) => wasm.applyAction(config, seed, events, action),
    viewHand: (config, seed, events) => wasm.viewHand(config, seed, events),
    evaluate: (cards) => wasm.evaluate(Uint8Array.from(cards)),
    equity: ({ hero, villain, board, dead = [], options = {} }) =>
      wasm.equity(Uint8Array.from(hero), villain, Uint8Array.from(board), Uint8Array.from(dead), options),
    analyze: ({ config, seed, events, heroSeat, ranges, options = {} }) => {
      // One flat array of 1,326 weights per range keeps the boundary crossing cheap.
      const seats = Uint32Array.from(ranges.map((r) => r.seat));
      const weights = new Float32Array(ranges.length * 1326);
      ranges.forEach((r, i) => weights.set(r.range, i * 1326));
      return wasm.analyze(config, seed, events, heroSeat, seats, weights, options);
    },
    comboStrengths: (board, dead = []) => wasm.comboStrengths(Uint8Array.from(board), Uint8Array.from(dead)),
    parseRange: (notation) => wasm.parseRange(notation),
    rangeToNotation: (range) => wasm.rangeToNotation(range),
    evalThroughput: (hands) => wasm.evalThroughput(hands),
  };
}
