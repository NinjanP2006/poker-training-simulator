// One shared core worker for the whole app.

import { createCore, type Core } from "./coreClient";

let core: Core | null = null;

export function getCore(): Core {
  core ??= createCore();
  return core;
}

export type StartupInfo = {
  /** Time to build the evaluator's lookup tables inside the worker. */
  tableMs: number;
  /** 7-card evaluations per second inside the worker on the very first run. */
  firstRunEvalsPerSec: number;
  /** Best of three runs, once the browser has optimized the WebAssembly. */
  evalsPerSec: number;
};

let startup: Promise<StartupInfo> | null = null;

/**
 * Warms the core up once (later calls share the same result).
 *
 * Browsers first run WebAssembly with a quick baseline compiler and swap in
 * optimized code shortly after, so the first measurement is pessimistic.
 * Both numbers are kept: the steady-state one is what equity requests get.
 */
export function coreStartup(): Promise<StartupInfo> {
  startup ??= (async () => {
    const c = getCore();
    const tableMs = await c.warmUp();
    const runs: number[] = [];
    for (let i = 0; i < 3; i++) runs.push(await c.evalThroughput(200_000));
    return { tableMs, firstRunEvalsPerSec: runs[0], evalsPerSec: Math.max(...runs) };
  })();
  return startup;
}
