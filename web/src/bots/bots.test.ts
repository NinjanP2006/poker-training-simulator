// Bots playing full hands against each other through the real core, plus
// the range tracker run over those same hands.

import { beforeAll, describe, expect, it } from "vitest";
import { comboIndex } from "../core/combos";
import type { BotProfile, HandView, TableConfig } from "../core/types";
import { wasmCore } from "../test/wasmCore";
import { type BotDecision, decide } from "./bot";
import { type CompiledProfiles, compileProfiles, populationModel, profileModel, StrengthCache } from "./model";
import { comboCount, narrow, trackRanges } from "./tracker";

const core = wasmCore();
let profiles: CompiledProfiles;

beforeAll(async () => {
  profiles = await compileProfiles(core);
});

const LINEUP: BotProfile[] = ["balancedReg", "looseAggressive", "tightPassive", "callingStation", "balancedReg", "looseAggressive"];

function sixMax(button: number): TableConfig {
  return {
    seats: LINEUP.map((profile) => ({ player: { kind: "bot" as const, profile }, stack: 200 })),
    smallBlind: 1,
    bigBlind: 2,
    button,
  };
}

type Played = { config: TableConfig; seed: string; view: HandView; decisions: (BotDecision & { seat: number; before: HandView })[] };

async function playHand(config: TableConfig, seed: string): Promise<Played> {
  const strengths = new StrengthCache(core);
  let view = await core.newHand(config, seed);
  const decisions: Played["decisions"] = [];
  while (view.legal) {
    const seat = view.legal.seat;
    const decision = await decide(profiles[LINEUP[seat]], config, seed, view, strengths);
    decisions.push({ ...decision, seat, before: view });
    view = await core.applyAction(config, seed, view.events, decision.action); // throws if illegal
    if (decisions.length > 200) throw new Error("hand never finished");
  }
  return { config, seed, view, decisions };
}

let hands: Played[] = [];

describe("bots", () => {
  beforeAll(async () => {
    hands = [];
    for (let i = 0; i < 120; i++) hands.push(await playHand(sixMax(i % 6), String(1000 + i)));
  }, 60_000);

  it("play complete hands using only legal actions", () => {
    expect(hands).toHaveLength(120);
    for (const h of hands) expect(h.view.complete).toBe(true);
    const total = hands.reduce((n, h) => n + h.decisions.length, 0);
    expect(total).toBeGreaterThan(400);
  });

  it("replay identically from the same seed", async () => {
    const again = await playHand(hands[7].config, hands[7].seed);
    expect(again.view.events).toEqual(hands[7].view.events);
  });

  it("each style plays like its description", () => {
    const stats = (profile: BotProfile) => {
      const mine = hands.flatMap((h) => h.decisions.filter((d) => LINEUP[d.seat] === profile));
      const pre = mine.filter((d) => d.situation.street === "preflop" && d.before.legal!.toCall > 0);
      const facingBet = mine.filter((d) => d.situation.street === "postflop" && d.situation.facingBet);
      return {
        preflopAggression: pre.filter((d) => d.actionClass === "aggressive").length / pre.length,
        preflopPlays: pre.filter((d) => d.actionClass !== "fold").length / pre.length,
        foldsToBets: facingBet.filter((d) => d.actionClass === "fold").length / Math.max(1, facingBet.length),
      };
    };
    const lag = stats("looseAggressive");
    const reg = stats("balancedReg");
    const tp = stats("tightPassive");
    const station = stats("callingStation");
    expect(lag.preflopAggression).toBeGreaterThan(reg.preflopAggression);
    expect(reg.preflopAggression).toBeGreaterThan(tp.preflopAggression);
    expect(station.preflopPlays).toBeGreaterThan(tp.preflopPlays);
    expect(station.foldsToBets).toBeLessThan(reg.foldsToBets);
  });

  it("never rules out a bot's real hand when its ranges are tracked with its own profile", async () => {
    for (const h of hands.slice(0, 40)) {
      const strengths = new StrengthCache(core);
      const ranges = await trackRanges(core, h.config, h.seed, h.view.events, (s) => profileModel(profiles[LINEUP[s]]), strengths, {
        floor: 0, // exact model: impossible hands go to zero
      });
      h.view.players.forEach((p, seat) => {
        const [a, b] = p.hole!;
        expect(ranges[seat][comboIndex(a, b)], `hand ${h.seed}, seat ${seat}`).toBeGreaterThan(0);
      });
    }
  }, 60_000);
});

describe("range narrowing", () => {
  it("an open raise narrows to exactly the raising range of a known profile", async () => {
    // Button 3: seat 0 is under the gun and acts first. Seat 0 plays tight-passive here.
    const config = sixMax(3);
    const before = await core.newHand(config, "7");
    expect(before.legal?.seat).toBe(0);
    const range = new Float32Array(1326).fill(1);
    await narrow(range, profileModel(profiles.tightPassive), config, before, 0, { kind: "raise", to: 5 }, new StrengthCache(core), 0);
    expect(comboCount(range)).toBeCloseTo(6 * 5 + 4 * 2 + 12, 3); // TT+ (30), AQs+ (8), AKo (12)
  });

  it("with the profile unknown, the population model narrows less sharply", async () => {
    const config = sixMax(3);
    const before = await core.newHand(config, "7");
    const raise = { kind: "raise" as const, to: 5 };
    const known = new Float32Array(1326).fill(1);
    const unknown = new Float32Array(1326).fill(1);
    await narrow(known, profileModel(profiles.tightPassive), config, before, 0, raise, new StrengthCache(core), 0);
    await narrow(unknown, populationModel(profiles), config, before, 0, raise, new StrengthCache(core), 0);
    expect(comboCount(unknown)).toBeGreaterThan(comboCount(known));
  });

  it("the floor keeps unlikely hands at a small weight instead of zero", async () => {
    const config = sixMax(3);
    const before = await core.newHand(config, "7");
    const range = new Float32Array(1326).fill(1);
    await narrow(range, profileModel(profiles.tightPassive), config, before, 0, { kind: "raise", to: 5 }, new StrengthCache(core));
    expect(Math.min(...range)).toBeGreaterThan(0);
    expect(Math.min(...range)).toBeLessThan(0.05);
  });
});
