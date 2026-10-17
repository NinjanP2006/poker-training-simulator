import type { BotProfile } from "../core/types";
import type { Position } from "./positions";

// The four bot styles, as data. Bots are deliberately simple and exploitable:
// they're a teaching tool, not a strong opponent.
//
// Preflop, each profile is a set of ranges (range notation, weights allowed).
// Postflop, a hand is put in one of five strength buckets (see BUCKET_EDGES)
// and each bucket has fixed action probabilities.

/** Strength cut points between the buckets: air, weak, medium, strong, nuts. */
export const BUCKET_EDGES = [0.35, 0.6, 0.8, 0.93] as const;
export const BUCKET_NAMES = ["air", "weak", "medium", "strong", "nuts"] as const;

type PerBucket<T> = [T, T, T, T, T];
/** [fold, call, raise] */
type Response = [number, number, number];

export type PreflopSpec = {
  /** First in (or after limpers): raise these, limp/call these, fold the rest. */
  open: Record<Exclude<Position, "BB">, { raise: string; limp?: string }>;
  /** Heads-up button (who is also the small blind). */
  headsUpButton: { raise: string; limp?: string };
  /** Big blind when everyone limped: raise these, check the rest. */
  bigBlindOption: string;
  /** Facing one raise: re-raise, call, or fold. */
  vsRaise: { raise: string; call: string };
  /** Facing a 3-bet or more. */
  vs3bet: { raise: string; call: string };
};

export type PostflopSpec = {
  /** Chance of betting when checked to, per bucket. */
  bet: PerBucket<number>;
  /** [fold, call, raise] facing a half-pot bet, per bucket. */
  facingBet: PerBucket<Response>;
  /** How much folding scales with the price faced: 0 ignores bet size, 1 is fully proportional. */
  sizeSensitivity: number;
  /** Bet size as a fraction of the pot. */
  betFraction: number;
  /** Raise to this multiple of the bet faced. */
  raiseMultiple: number;
};

export type ProfileSpec = {
  id: BotProfile;
  name: string;
  description: string;
  preflop: PreflopSpec;
  postflop: PostflopSpec;
};

const balancedReg: ProfileSpec = {
  id: "balancedReg",
  name: "Balanced reg",
  description: "Position-based standard ranges; a mix of value bets and bluffs.",
  preflop: {
    open: {
      UTG: { raise: "77+, ATs+, KTs+, QTs+, JTs, T9s, AQo+, KQo" },
      HJ: { raise: "66+, A9s+, A5s-A4s, KTs+, QTs+, J9s+, T9s, 98s, AJo+, KQo" },
      CO: { raise: "44+, A2s+, K8s+, Q9s+, J9s+, T8s+, 97s+, 87s, 76s, ATo+, KJo+, QJo" },
      BTN: { raise: "22+, A2s+, K5s+, Q7s+, J7s+, T7s+, 96s+, 86s+, 75s+, 65s, 54s, A7o+, K9o+, Q9o+, J9o+, T9o" },
      SB: { raise: "22+, A2s+, K6s+, Q8s+, J8s+, T8s+, 97s+, 87s, 76s, 65s, A8o+, KTo+, QTo+, JTo" },
    },
    headsUpButton: { raise: "22+, A2s+, A2o+, K2s+, K5o+, Q4s+, Q8o+, J6s+, J8o+, T6s+, T8o+, 96s+, 98o, 85s+, 75s+, 64s+, 54s" },
    bigBlindOption: "88+, ATs+, KJs+, AQo+",
    vsRaise: {
      raise: "QQ+, AKs, AKo, 0.5(A5s-A4s)",
      call: "22-JJ, ATs-AQs, KJs+, QJs, JTs, T9s, 98s, AQo, KQo",
    },
    vs3bet: { raise: "KK+, AKs", call: "TT-QQ, AKo, AQs" },
  },
  postflop: {
    bet: [0.3, 0.1, 0.45, 0.7, 0.8],
    facingBet: [
      [0.85, 0.05, 0.1],
      [0.6, 0.38, 0.02],
      [0.2, 0.75, 0.05],
      [0.03, 0.72, 0.25],
      [0, 0.4, 0.6],
    ],
    sizeSensitivity: 1,
    betFraction: 0.66,
    raiseMultiple: 3,
  },
};

const looseAggressive: ProfileSpec = {
  id: "looseAggressive",
  name: "Loose-aggressive",
  description: "Wide ranges, raises often, bets and bluffs a lot.",
  preflop: {
    open: {
      UTG: { raise: "55+, A2s+, K9s+, Q9s+, J9s+, T8s+, 98s, 87s, 76s, ATo+, KJo+" },
      HJ: { raise: "33+, A2s+, K7s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 76s, 65s, A9o+, KTo+, QJo" },
      CO: { raise: "22+, A2s+, K4s+, Q6s+, J7s+, T7s+, 96s+, 86s+, 75s+, 64s+, 54s, A5o+, K9o+, Q9o+, J9o+, T9o" },
      BTN: { raise: "22+, A2s+, A2o+, K2s+, K7o+, Q4s+, Q9o+, J6s+, J9o+, T6s+, T9o, 95s+, 98o, 85s+, 74s+, 64s+, 53s+, 43s" },
      SB: { raise: "22+, A2s+, K4s+, Q6s+, J7s+, T7s+, 96s+, 86s+, 75s+, 64s+, 54s, A5o+, K9o+, Q9o+, J9o+, T9o" },
    },
    headsUpButton: { raise: "22+, A2s+, A2o+, K2s+, K2o+, Q2s+, Q6o+, J4s+, J7o+, T5s+, T7o+, 95s+, 97o+, 84s+, 87o, 74s+, 63s+, 53s+, 43s" },
    bigBlindOption: "66+, A8s+, KTs+, QJs, ATo+, KQo, 0.5(76s, 65s, 54s)",
    vsRaise: {
      raise: "TT+, AQs+, AKo, A5s-A2s, KQs, 0.5(87s, 76s, 65s, 54s)",
      call: "22-99, A6s-AJs, KTs-KJs, QTs+, JTs, T9s, 98s, AJo-AQo, KQo",
    },
    vs3bet: { raise: "QQ+, AKs, AKo, 0.5(A5s-A4s)", call: "TT-JJ, AQs, KQs, JTs" },
  },
  postflop: {
    bet: [0.5, 0.35, 0.65, 0.8, 0.85],
    facingBet: [
      [0.6, 0.1, 0.3],
      [0.4, 0.45, 0.15],
      [0.12, 0.73, 0.15],
      [0.02, 0.6, 0.38],
      [0, 0.35, 0.65],
    ],
    sizeSensitivity: 0.8,
    betFraction: 0.75,
    raiseMultiple: 3,
  },
};

const tightPassive: ProfileSpec = {
  id: "tightPassive",
  name: "Tight-passive",
  description: "Narrow ranges, mostly limps and calls; bets only strong hands.",
  preflop: {
    open: {
      UTG: { raise: "TT+, AQs+, AKo", limp: "22-99, ATs-AJs, KQs, QJs, JTs, AJo-AQo, KQo" },
      HJ: { raise: "TT+, AQs+, AKo", limp: "22-99, ATs-AJs, KQs, QJs, JTs, AJo-AQo, KQo" },
      CO: { raise: "TT+, AQs+, AKo", limp: "22-99, A9s-AJs, KJs+, QJs, JTs, ATo-AQo, KQo" },
      BTN: { raise: "TT+, AJs+, AKo", limp: "22-99, A8s-ATs, KTs+, QTs+, JTs, T9s, ATo-AQo, KJo+" },
      SB: { raise: "TT+, AQs+, AKo", limp: "22-99, A8s-AJs, KTs+, QJs, JTs, ATo-AQo, KQo" },
    },
    headsUpButton: { raise: "TT+, AJs+, AQo+", limp: "22-99, A2s-ATs, K9s+, QTs+, JTs, A9o-AJo, KJo+" },
    bigBlindOption: "QQ+, AKs",
    vsRaise: { raise: "KK+", call: "77-QQ, AJs-AQs, AKs, AKo, KQs" },
    vs3bet: { raise: "AA", call: "QQ-KK, AKs" },
  },
  postflop: {
    bet: [0.03, 0.05, 0.2, 0.45, 0.6],
    facingBet: [
      [0.97, 0.03, 0],
      [0.8, 0.2, 0],
      [0.4, 0.6, 0],
      [0.1, 0.85, 0.05],
      [0, 0.75, 0.25],
    ],
    sizeSensitivity: 1,
    betFraction: 0.5,
    raiseMultiple: 2.5,
  },
};

const callingStation: ProfileSpec = {
  id: "callingStation",
  name: "Calling station",
  description: "Plays lots of hands, rarely raises, calls down with weak pairs and draws.",
  preflop: {
    open: {
      UTG: { raise: "TT+, AJs+, AKo", limp: "22+, A2s+, K2s+, Q5s+, J7s+, T7s+, 97s+, 86s+, 75s+, 64s+, 54s, A2o+, K8o+, Q9o+, J9o+, T9o" },
      HJ: { raise: "TT+, AJs+, AKo", limp: "22+, A2s+, K2s+, Q5s+, J7s+, T7s+, 97s+, 86s+, 75s+, 64s+, 54s, A2o+, K8o+, Q9o+, J9o+, T9o" },
      CO: { raise: "TT+, AJs+, AKo", limp: "22+, A2s+, K2s+, Q4s+, J6s+, T6s+, 96s+, 85s+, 75s+, 64s+, 53s+, A2o+, K7o+, Q8o+, J8o+, T8o+, 98o" },
      BTN: { raise: "TT+, AJs+, AKo", limp: "22+, A2s+, K2s+, Q2s+, J5s+, T6s+, 95s+, 85s+, 74s+, 63s+, 53s+, A2o+, K5o+, Q7o+, J8o+, T8o+, 98o" },
      SB: { raise: "TT+, AJs+, AKo", limp: "22+, A2s+, K2s+, Q4s+, J6s+, T6s+, 96s+, 85s+, 75s+, 64s+, 53s+, A2o+, K7o+, Q8o+, J8o+, T8o+, 98o" },
    },
    headsUpButton: { raise: "TT+, AJs+, AKo", limp: "22+, A2s+, K2s+, Q2s+, J4s+, T5s+, 95s+, 84s+, 74s+, 63s+, 53s+, A2o+, K4o+, Q6o+, J7o+, T7o+, 97o+" },
    bigBlindOption: "JJ+, AKs",
    vsRaise: {
      raise: "QQ+",
      call: "22-JJ, A2s+, K2s+, Q6s+, J7s+, T7s+, 96s+, 86s+, 75s+, 65s, 54s, A2o+, K9o+, Q9o+, J9o+, T9o",
    },
    vs3bet: { raise: "KK+", call: "22-QQ, ATs+, KQs, AJo+" },
  },
  postflop: {
    bet: [0.05, 0.1, 0.25, 0.4, 0.5],
    facingBet: [
      [0.55, 0.45, 0],
      [0.2, 0.8, 0],
      [0.05, 0.95, 0],
      [0, 0.95, 0.05],
      [0, 0.85, 0.15],
    ],
    sizeSensitivity: 0.3,
    betFraction: 0.5,
    raiseMultiple: 2.5,
  },
};

export const PROFILES: Record<BotProfile, ProfileSpec> = {
  balancedReg,
  looseAggressive,
  tightPassive,
  callingStation,
};

export const PROFILE_IDS = Object.keys(PROFILES) as BotProfile[];
