// The UI's handle on the core. Each call posts a message to the worker and
// returns a Promise that settles when the matching reply (same id) arrives.

import type { CoreApi, Method, WorkerRequest, WorkerResponse } from "./protocol";

/** CoreApi with every method made async. */
export type Core = {
  [M in Method]: (...args: Parameters<CoreApi[M]>) => Promise<ReturnType<CoreApi[M]>>;
};

export function createCore(): Core {
  const worker = new Worker(new URL("./core.worker.ts", import.meta.url), { type: "module" });
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let nextId = 0;

  worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
    const call = pending.get(data.id);
    if (!call) return;
    pending.delete(data.id);
    if (data.ok) {
      call.resolve(data.value);
    } else {
      call.reject(new Error(data.error));
    }
  };

  // If the worker itself fails (e.g. the .wasm file can't load), fail every waiting call.
  worker.onerror = (event) => {
    const error = new Error(`core worker failed: ${event.message}`);
    for (const call of pending.values()) call.reject(error);
    pending.clear();
  };

  function call<M extends Method>(method: M, ...args: Parameters<CoreApi[M]>): Promise<ReturnType<CoreApi[M]>> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      worker.postMessage({ id, method, args } satisfies WorkerRequest);
    });
  }

  return {
    warmUp: () => call("warmUp"),
    newHand: (...a) => call("newHand", ...a),
    applyAction: (...a) => call("applyAction", ...a),
    viewHand: (...a) => call("viewHand", ...a),
    evaluate: (...a) => call("evaluate", ...a),
    equity: (...a) => call("equity", ...a),
    parseRange: (...a) => call("parseRange", ...a),
    rangeToNotation: (...a) => call("rangeToNotation", ...a),
    evalThroughput: (...a) => call("evalThroughput", ...a),
  };
}
