// Runs the Rust core (compiled to WebAssembly) off the main thread, so long
// equity calculations never freeze the table.
//
// Receives { id, method, args }, calls the matching function, and replies with
// { id, ok: true, value } or { id, ok: false, error }.

import init, * as wasm from "../wasm/poker_wasm";
import type { CoreApi, WorkerRequest, WorkerResponse } from "./protocol";

const api: CoreApi = {
  warmUp: () => wasm.warmUp(),
  newHand: (config, seed) => wasm.newHand(config, seed),
  applyAction: (config, seed, events, action) => wasm.applyAction(config, seed, events, action),
  viewHand: (config, seed, events) => wasm.viewHand(config, seed, events),
  evaluate: (cards) => wasm.evaluate(Uint8Array.from(cards)),
  equity: ({ hero, villain, board, dead = [], options = {} }) =>
    wasm.equity(Uint8Array.from(hero), villain, Uint8Array.from(board), Uint8Array.from(dead), options),
  parseRange: (notation) => wasm.parseRange(notation),
  rangeToNotation: (range) => wasm.rangeToNotation(range),
  evalThroughput: (hands) => wasm.evalThroughput(hands),
};

// The DOM typings describe `self` as a window; in a worker, postMessage takes one argument.
const scope = self as unknown as {
  postMessage(message: WorkerResponse): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};

// Fetch and compile the .wasm file once; every request waits for it.
const ready = init();

scope.onmessage = async ({ data: { id, method, args } }) => {
  try {
    await ready;
    const fn = api[method] as (...a: unknown[]) => unknown;
    scope.postMessage({ id, ok: true, value: fn(...args) });
  } catch (err) {
    scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
