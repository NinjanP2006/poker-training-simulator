import { beforeAll, describe, expect, it } from "vitest";
import { comboIndex, COMBOS } from "../core/combos";
import { parseCards } from "../core/cards";
import type { LegalActions } from "../core/types";
import { wasmCore } from "../test/wasmCore";
import { foldCurve } from "./foldCurve";
import {
  bucketOf,
  type CompiledProfiles,
  compileProfiles,
  effectiveProbs,
  populationModel,
  profileModel,
  rawProbs,
  type Situation,
} from "./model";
import type { Position } from "./positions";
import { PROFILE_IDS } from "./profiles";

let profiles: CompiledProfiles;
let strengths: Float32Array;

beforeAll(async () => {
  profiles = await compileProfiles(wasmCore());
  strengths = await wasmCore().comboStrengths(parseCards("Ah 7h 2c"));
});

const combo = (hand: string) => {
  const [a, b] = parseCards(hand);
  return comboIndex(a, b);
};

const allSituations = (): Situation[] => {
  const positions: Position[] = ["UTG", "HJ", "CO", "BTN", "SB", "BB"];
  const pre: Situation[] = positions.flatMap((position) =>
    (["open", "option", "vsRaise", "vs3bet"] as const).flatMap((spot) =>
      [false, true].map((headsUp) => ({ street: "preflop" as const, spot, position, headsUp })),
    ),
  );
  const post: Situation[] = [0.1, 0.25, 0.4, 0.6].map((potOdds) => ({ street: "postflop", facingBet: true, potOdds }));
  return [...pre, ...post, { street: "postflop", facingBet: false, potOdds: 0 }];
};

describe("opponent model", () => {
  it("gives valid probabilities for every profile, spot and combo", () => {
    const models = [...PROFILE_IDS.map((id) => profileModel(profiles[id])), populationModel(profiles)];
    let lowest = Infinity;
    let highest = -Infinity;
    let worstSumError = 0;
    for (const model of models) {
      for (const s of allSituations()) {
        for (let c = 0; c < COMBOS; c++) {
          const p = rawProbs(model, s, c, strengths);
          lowest = Math.min(lowest, p.fold, p.passive, p.aggressive);
          highest = Math.max(highest, p.fold, p.passive, p.aggressive);
          worstSumError = Math.max(worstSumError, Math.abs(p.fold + p.passive + p.aggressive - 1));
        }
      }
    }
    expect(lowest).toBeGreaterThanOrEqual(-1e-9);
    expect(highest).toBeLessThanOrEqual(1 + 1e-9);
    expect(worstSumError).toBeLessThan(1e-9);
  });

  it("follows each profile's preflop ranges", () => {
    const open: Situation = { street: "preflop", spot: "open", position: "UTG", headsUp: false };
    const tp = profileModel(profiles.tightPassive);
    expect(rawProbs(tp, open, combo("Ah Ad"), null)).toEqual({ fold: 0, passive: 0, aggressive: 1 });
    expect(rawProbs(tp, open, combo("5h 5d"), null)).toEqual({ fold: 0, passive: 1, aggressive: 0 }); // limps small pairs
    expect(rawProbs(tp, open, combo("7h 2d"), null)).toEqual({ fold: 1, passive: 0, aggressive: 0 });
    // The reg mixes A5s as a 3-bet bluff half the time.
    const vsRaise: Situation = { ...open, spot: "vsRaise" };
    expect(rawProbs(profileModel(profiles.balancedReg), vsRaise, combo("Ah 5h"), null).aggressive).toBeCloseTo(0.5);
  });

  it("folds more to bigger bets, except the calling station barely cares", () => {
    const weak = combo("Kd Qc"); // no pair, no draw on Ah 7h 2c
    const facing = (potOdds: number): Situation => ({ street: "postflop", facingBet: true, potOdds });
    const foldAt = (id: keyof CompiledProfiles, po: number) => rawProbs(profileModel(profiles[id]), facing(po), weak, strengths).fold;
    expect(foldAt("balancedReg", 0.4)).toBeGreaterThan(foldAt("balancedReg", 0.2));
    const regSwing = foldAt("balancedReg", 0.4) - foldAt("balancedReg", 0.15);
    const stationSwing = foldAt("callingStation", 0.4) - foldAt("callingStation", 0.15);
    expect(stationSwing).toBeLessThan(regSwing);
  });

  it("the population model averages the four profiles", () => {
    const s: Situation = { street: "postflop", facingBet: true, potOdds: 0.3 };
    const c = combo("Kh Qh");
    const avg = PROFILE_IDS.map((id) => rawProbs(profileModel(profiles[id]), s, c, strengths).fold).reduce((a, b) => a + b) / 4;
    expect(rawProbs(populationModel(profiles), s, c, strengths).fold).toBeCloseTo(avg, 12);
  });

  it("makes probabilities legal: no folding when checking is free, no raising when it isn't allowed", () => {
    const legal = (toCall: number, minRaiseTo: number | null): LegalActions => ({
      seat: 0,
      toCall,
      callIsAllIn: false,
      minRaiseTo,
      maxRaiseTo: 100,
      isBet: toCall === 0,
    });
    const p = { fold: 0.2, passive: 0.5, aggressive: 0.3 };
    expect(effectiveProbs(p, legal(0, 4))).toEqual({ fold: 0, passive: 0.7, aggressive: 0.3 });
    expect(effectiveProbs(p, legal(10, null))).toEqual({ fold: 0.2, passive: 0.8, aggressive: 0 });
  });

  it("buckets strengths at the edges", () => {
    expect([0, 0.34, 0.35, 0.7, 0.85, 0.95].map(bucketOf)).toEqual([0, 0, 1, 2, 3, 4]);
  });

  it("fold curves rise with the price for a size-sensitive profile", () => {
    const view = { street: "flop", raisesThisStreet: 0 } as Parameters<typeof foldCurve>[3];
    const config = { seats: [{ player: { kind: "hero" as const }, stack: 200 }, { player: { kind: "hero" as const }, stack: 200 }], smallBlind: 1, bigBlind: 2, button: 0 };
    const full = new Float32Array(COMBOS).fill(1);
    const curve = foldCurve(profileModel(profiles.balancedReg), full, 1, view, config, strengths, parseCards("Ah 7h 2c"));
    for (let i = 1; i < curve.length; i++) expect(curve[i][1]).toBeGreaterThanOrEqual(curve[i - 1][1]);
    expect(curve.at(-1)![1]).toBeGreaterThan(curve[0][1]);
  });
});
