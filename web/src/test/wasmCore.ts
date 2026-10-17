// Test helper: the real compiled core, loaded directly in Node (no worker),
// behind the same async `Core` interface the app uses.

import { readFileSync } from "node:fs";
import * as wasm from "../wasm/poker_wasm";
import { createApi } from "../worker/api";
import type { Core } from "../worker/coreClient";
import type { CoreApi } from "../worker/protocol";

let core: Core | null = null;

export function wasmCore(): Core {
  if (!core) {
    wasm.initSync({ module: readFileSync(new URL("../wasm/poker_wasm_bg.wasm", import.meta.url)) });
    const api = createApi(wasm);
    const methods = Object.keys(api) as (keyof CoreApi)[];
    core = Object.fromEntries(
      methods.map((m) => [m, async (...args: unknown[]) => (api[m] as (...a: unknown[]) => unknown)(...args)]),
    ) as Core;
  }
  return core;
}
