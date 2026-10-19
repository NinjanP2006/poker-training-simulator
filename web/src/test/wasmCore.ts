// Test helper: the real compiled core, loaded directly in Node (no worker),
// behind the same async `Core` interface the app uses.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as wasm from "../wasm/poker_wasm";
import { createApi } from "../worker/api";
import type { Core } from "../worker/coreClient";
import type { CoreApi } from "../worker/protocol";

let core: Core | null = null;

export function wasmCore(): Core {
  if (!core) {
    // Resolved from the project folder (where Vitest runs): under jsdom,
    // import.meta.url isn't a file:// URL.
    wasm.initSync({ module: readFileSync(resolve(process.cwd(), "src/wasm/poker_wasm_bg.wasm")) });
    const api = createApi(wasm);
    const methods = Object.keys(api) as (keyof CoreApi)[];
    core = Object.fromEntries(
      methods.map((m) => [m, async (...args: unknown[]) => (api[m] as (...a: unknown[]) => unknown)(...args)]),
    ) as Core;
  }
  return core;
}
