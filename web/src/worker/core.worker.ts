// Runs the Rust core (compiled to WebAssembly) off the main thread, so long
// equity calculations never freeze the table.
//
// Receives { id, method, args }, calls the matching function, and replies with
// { id, ok: true, value } or { id, ok: false, error }.

import init, * as wasm from "../wasm/poker_wasm";
import { createApi } from "./api";
import type { WorkerRequest, WorkerResponse } from "./protocol";

const api = createApi(wasm);

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
