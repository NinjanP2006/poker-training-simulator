// The opponent model: for any combo in any spot, how likely each kind of
// action is. Bots sample from it to play; range tracking multiplies by it to
// narrow ranges. Because both use this one function, the estimated ranges
// match how the bots actually play.

import type { Action, BotProfile, HandView, LegalActions, TableConfig } from "../core/types";
import { COMBOS } from "../core/combos";
import type { Core } from "../worker/coreClient";
import { positionOf, type Position } from "./positions";
import { BUCKET_EDGES, PROFILE_IDS, PROFILES, type ProfileSpec } from "./profiles";

/** Kinds of action. Every concrete action falls into exactly one. */
export type ActionClass = "fold" | "passive" | "aggressive";

export type Probs = Record<ActionClass, number>;

export type Situation =
  | { street: "preflop"; spot: "open" | "option" | "vsRaise" | "vs3bet"; position: Position; headsUp: boolean }
  | { street: "postflop"; facingBet: boolean; potOdds: number };

type Ranges = { raise: Float32Array; passive: Float32Array };

/** A profile with its range notation parsed into weights. */
export type CompiledProfile = {
  spec: ProfileSpec;
  open: Record<Exclude<Position, "BB">, Ranges>;
  headsUpButton: Ranges;
  bigBlindOption: Float32Array;
  vsRaise: Ranges;
  vs3bet: Ranges;
};

/** One profile, or the population average when the profile is unknown. */
export type Model = { kind: "profile"; profile: CompiledProfile } | { kind: "population"; profiles: CompiledProfile[] };

export type CompiledProfiles = Record<BotProfile, CompiledProfile>;

/** Parses every profile's ranges once (via the core's range parser). */
export async function compileProfiles(core: Core): Promise<CompiledProfiles> {
  const parse = (notation: string | undefined) =>
    notation ? core.parseRange(notation) : Promise.resolve(new Float32Array(COMBOS));
  const ranges = async (r: { raise: string; limp?: string; call?: string }): Promise<Ranges> => ({
    raise: await parse(r.raise),
    passive: await parse(r.limp ?? r.call),
  });
  const compiled = {} as CompiledProfiles;
  for (const id of PROFILE_IDS) {
    const spec = PROFILES[id];
    const p = spec.preflop;
    compiled[id] = {
      spec,
      open: {
        UTG: await ranges(p.open.UTG),
        HJ: await ranges(p.open.HJ),
        CO: await ranges(p.open.CO),
        BTN: await ranges(p.open.BTN),
        SB: await ranges(p.open.SB),
      },
      headsUpButton: await ranges(p.headsUpButton),
      bigBlindOption: await parse(p.bigBlindOption),
      vsRaise: await ranges(p.vsRaise),
      vs3bet: await ranges(p.vs3bet),
    };
  }
  return compiled;
}

export const profileModel = (profile: CompiledProfile): Model => ({ kind: "profile", profile });
export const populationModel = (all: CompiledProfiles): Model => ({ kind: "population", profiles: PROFILE_IDS.map((id) => all[id]) });

/** The spot a seat is in, from the hand as it stands before they act. */
export function situationFor(view: HandView, config: TableConfig, seat: number): Situation {
  const toCall = view.legal?.seat === seat ? view.legal.toCall : view.currentBet - view.players[seat].streetBet;
  if (view.street !== "preflop") {
    return { street: "postflop", facingBet: toCall > 0, potOdds: toCall > 0 ? toCall / (view.pot + toCall) : 0 };
  }
  const position = positionOf(seat, config);
  const headsUp = config.seats.length === 2;
  const raises = view.raisesThisStreet;
  const spot = raises >= 2 ? "vs3bet" : raises === 1 ? "vsRaise" : toCall === 0 ? "option" : "open";
  return { street: "preflop", spot, position, headsUp };
}

/** How strongly each bucket's folding reacts to bet size: air, weak, medium fully; strong half; nuts not at all. */
const BUCKET_SIZE_SENSITIVITY = [1, 1, 1, 0.5, 0];

/**
 * The bet's size relative to the pot before it, from the pot odds it offers:
 * calling C into a pot of P (which includes the bet) gives odds x = C/(P+C),
 * and the bet was C into P − C, so C/(P − C) = x / (1 − 2x).
 * Half pot → 0.5, pot → 1, 2× pot → 2. Capped at 20× pot.
 */
export function betToPot(potOdds: number): number {
  const x = Math.min(potOdds, 0.4878); // 20× pot
  return x / (1 - 2 * x);
}

export function bucketOf(strength: number): number {
  let b = 0;
  while (b < BUCKET_EDGES.length && strength >= BUCKET_EDGES[b]) b++;
  return b;
}

/**
 * How likely each action class is for `combo` in `situation`, before
 * accounting for what's legal. `strengths` (from core.comboStrengths) is
 * needed postflop.
 */
export function rawProbs(model: Model, situation: Situation, combo: number, strengths: Float32Array | null): Probs {
  if (model.kind === "population") {
    // The population average: each style equally likely.
    const sum: Probs = { fold: 0, passive: 0, aggressive: 0 };
    for (const p of model.profiles) {
      const q = profileProbs(p, situation, combo, strengths);
      sum.fold += q.fold;
      sum.passive += q.passive;
      sum.aggressive += q.aggressive;
    }
    const n = model.profiles.length;
    return { fold: sum.fold / n, passive: sum.passive / n, aggressive: sum.aggressive / n };
  }
  return profileProbs(model.profile, situation, combo, strengths);
}

function profileProbs(p: CompiledProfile, s: Situation, combo: number, strengths: Float32Array | null): Probs {
  if (s.street === "preflop") {
    if (s.spot === "option") {
      const raise = p.bigBlindOption[combo];
      return { fold: 0, passive: 1 - raise, aggressive: raise };
    }
    const ranges =
      s.spot === "vsRaise"
        ? p.vsRaise
        : s.spot === "vs3bet"
          ? p.vs3bet
          : s.headsUp && s.position === "BTN"
            ? p.headsUpButton
            : p.open[s.position === "BB" ? "SB" : s.position];
    // Raise first; of the rest, the passive range calls/limps; the remainder folds.
    const aggressive = ranges.raise[combo];
    const passive = (1 - aggressive) * ranges.passive[combo];
    return { fold: 1 - aggressive - passive, passive, aggressive };
  }

  if (!strengths) throw new Error("postflop decisions need combo strengths");
  const post = p.spec.postflop;
  const bucket = bucketOf(strengths[combo]);
  if (!s.facingBet) {
    const bet = post.bet[bucket];
    return { fold: 0, passive: 1 - bet, aggressive: bet };
  }
  // Base frequencies are for a half-pot bet. Bigger bets shrink the share of
  // hands that continue (roughly with the square root of the size, so a pot
  // bet is defended about as much less as MDF says); smaller bets grow it.
  // Size is measured against the pot, not by pot odds, which flatten out near
  // 50% and can't tell a pot bet from a 15× overbet. The nuts never fold, and
  // strong hands react half as much.
  const [fold, call, raise] = post.facingBet[bucket];
  const rest = call + raise;
  if (rest === 0) return { fold: 1, passive: 0, aggressive: 0 };
  const sizeFactor = betToPot(s.potOdds) / 0.5;
  const sensitivity = post.sizeSensitivity * BUCKET_SIZE_SENSITIVITY[bucket];
  const scale = 1 / Math.sqrt(Math.max(0.1, 1 + sensitivity * (sizeFactor - 1)));
  const keep = Math.min(1, (1 - fold) * scale);
  return { fold: 1 - keep, passive: (keep * call) / rest, aggressive: (keep * raise) / rest };
}

/**
 * The probabilities after legality: nobody folds when they can check, and a
 * raise that isn't allowed becomes a call or check.
 */
export function effectiveProbs(p: Probs, legal: LegalActions): Probs {
  let { fold, passive, aggressive } = p;
  if (legal.toCall === 0) {
    passive += fold;
    fold = 0;
  }
  if (legal.minRaiseTo === null) {
    passive += aggressive;
    aggressive = 0;
  }
  return { fold, passive, aggressive };
}

/** Which class a concrete action belongs to, given the hand just before it. */
export function classify(action: Action, before: HandView, seat: number): ActionClass {
  switch (action.kind) {
    case "fold":
      return "fold";
    case "check":
    case "call":
      return "passive";
    case "bet":
    case "raise":
      return "aggressive";
    case "allIn": {
      const p = before.players[seat];
      return p.streetBet + p.stack > before.currentBet ? "aggressive" : "passive";
    }
  }
}

/** Board strengths, computed once per board. */
export class StrengthCache {
  private cache = new Map<string, Promise<Float32Array>>();
  private core: Core;

  constructor(core: Core) {
    this.core = core;
  }

  get(board: number[]): Promise<Float32Array> {
    const key = board.join(",");
    let hit = this.cache.get(key);
    if (!hit) {
      hit = this.core.comboStrengths(board);
      this.cache.set(key, hit);
    }
    return hit;
  }
}
