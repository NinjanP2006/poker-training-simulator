// Shared types for the poker core. The Rust core (via WASM) produces and
// consumes these same shapes, so keep the two in sync.
// All chip amounts are integers in chips; `evLost` is the one value in big blinds.

// ---------- Cards ----------

/** 0–51, encoded as rank * 4 + suit (rank 0 = deuce … 12 = ace). */
export type Card = number;

/** 64-bit set of cards: bit `c` is set if card `c` is in the set. */
export type CardMask = bigint;

/** 1,326 weights in [0, 1], one per two-card combo. */
export type Range = Float32Array;

// ---------- Table setup ----------

export type BotProfile =
  | "tightPassive"
  | "looseAggressive"
  | "callingStation"
  | "balancedReg";

export type SeatPlayer =
  | { kind: "hero" }
  | { kind: "bot"; profile: BotProfile };

export type SeatConfig = {
  player: SeatPlayer;
  stack: number;
};

export type TableConfig = {
  seats: SeatConfig[]; // length 2 (heads-up) or 6 (6-max)
  smallBlind: number;
  bigBlind: number;
  button: number; // seat index of the dealer button
};

// ---------- Actions and events ----------

export type Street = "preflop" | "flop" | "turn" | "river";

export type Action =
  | { kind: "fold" }
  | { kind: "check" }
  | { kind: "call" }
  | { kind: "bet"; amount: number }
  | { kind: "raise"; to: number }
  | { kind: "allIn" };

export type HandEvent =
  | { t: "deal"; seat: number; cards: [Card, Card] }
  | { t: "blind"; seat: number; amount: number }
  | { t: "act"; seat: number; action: Action }
  | { t: "board"; cards: Card[] }
  // One event per winner of each pot, so split pots and odd chips are explicit.
  | { t: "award"; potIndex: number; seat: number; amount: number };

/** Placeholder until the Rust game engine defines it (Phase 2). */
export type HandState = unknown;

// ---------- Equity and analysis ----------

export type EquityResult = {
  equity: number;
  win: number;
  tie: number;
  stdErr: number | null; // null when enumerated exactly
  method: "exact" | "montecarlo";
  evaluations: number;
};

export type DecisionLabel = "fine" | "marginal" | "mistake";

export type MistakeCategory =
  | "callingWide"
  | "overfolding"
  | "sizing"
  | "missedValue";

export type DecisionAnalysis = {
  street: Street;
  pot: number;
  toCall: number;
  effectiveStack: number;
  equity: EquityResult;
  potOdds: number;
  mdf: number | null;
  spr: number;
  impliedOddsNeeded: number | null;
  outs: { clean: Card[]; dirty: Card[] } | null;
  evByAction: { action: Action; ev: number }[];
  chosen: Action;
  evLost: number; // in big blinds
  label: DecisionLabel;
  category?: MistakeCategory;
};

export type HandHistory = {
  id: string;
  seed: string; // replays the shuffle exactly
  config: TableConfig;
  events: HandEvent[];
  analyses: DecisionAnalysis[]; // one per hero decision
};

// ---------- WASM boundary ----------

/** The API the Rust core exposes to TypeScript (implemented in Phase 5). */
export interface PokerCore {
  newHand(config: TableConfig, seed: string): HandState;
  applyAction(state: HandState, action: Action): HandState; // throws on illegal
  legalActions(state: HandState): Action[];
  evaluate(cards: CardMask): number;
  equity(
    hero: [Card, Card],
    villain: Range,
    board: Card[],
    dead: CardMask,
    opts: { budgetMs: number; maxStdErr: number },
  ): EquityResult;
  analyze(state: HandState, heroSeat: number, villainRange: Range): DecisionAnalysis;
  parseRange(notation: string): Range;
}
