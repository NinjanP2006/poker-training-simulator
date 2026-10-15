// Checks the TypeScript formulas against fixtures/formulas.json, the same
// cases the Rust formulas (crates/poker-core/src/math.rs) are tested against.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as f from "./formulas";

type Case = { args: number[]; expected: number | null; note?: string };

const fixtures: Record<string, Case[] | string> = JSON.parse(
  readFileSync(new URL("../../../fixtures/formulas.json", import.meta.url), "utf8"),
);

const formulas: Record<string, (...args: number[]) => number | null> = {
  potOdds: f.potOdds,
  equity: f.equity,
  evCall: f.evCall,
  evBet: f.evBet,
  bluffBreakEven: f.bluffBreakEven,
  mdf: f.mdf,
  impliedOdds: f.impliedOdds,
  choose: f.choose,
  outs: f.outs,
  spr: f.spr,
  pairCombos: f.pairCombos,
  unpairedCombos: f.unpairedCombos,
};

describe("shared formula fixtures", () => {
  for (const [name, cases] of Object.entries(fixtures)) {
    if (name.startsWith("_") || typeof cases === "string") continue;
    for (const { args, expected, note } of cases) {
      it(`${name}(${args.join(", ")})${note ? ` — ${note}` : ""}`, () => {
        const fn = formulas[name];
        expect(fn, `no TypeScript formula named ${name}`).toBeDefined();
        const got = fn(...args);
        if (expected === null) {
          expect(got).toBeNull();
        } else {
          expect(got).toBeCloseTo(expected, 5);
        }
      });
    }
  }
});
