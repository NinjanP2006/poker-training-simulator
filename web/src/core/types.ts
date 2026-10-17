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

// ---------- Hand state (derived by the engine from config + seed + events) ----------

export type PlayerView = {
  stack: number;
  streetBet: number;
  totalBet: number; // this is what side pots are built from
  folded: boolean;
  allIn: boolean;
  hole: [Card, Card] | null;
};

/** What the player to act may do. Bet/raise amounts are totals for the street. */
export type LegalActions = {
  seat: number;
  toCall: number; // 0 means they can check
  callIsAllIn: boolean;
  minRaiseTo: number | null; // null: can't bet or raise
  maxRaiseTo: number; // all-in
  isBet: boolean; // nobody has bet this street: use "bet", not "raise"
};

export type HandView = {
  events: HandEvent[];
  players: PlayerView[];
  board: Card[];
  street: Street;
  pot: number; // chips in the middle not yet awarded
  currentBet: number;
  raisesThisStreet: number; // preflop: 0 = unopened, 1 = opened, 2 = 3-bet, ...
  toAct: number | null;
  legal: LegalActions | null;
  complete: boolean;
};

// ---------- Equity and analysis ----------

export type EquityOptions = {
  budgetMs: number; // Monte Carlo time limit (default 80)
  maxStdErr: number; // Monte Carlo stops below this (default 0.005)
  exactLimit: number; // enumerate exactly up to this many evaluations (default 2,000,000)
  maxSamples: number;
  seed: number;
};

export type EquityResult = {
  equity: number;
  win: number;
  tie: number;
  stdErr: number | null; // null when enumerated exactly
  method: "exact" | "montecarlo";
  evaluations: number;
  liveCombos: number; // opponent combos left after blockers
};

export type DecisionLabel = "fine" | "marginal" | "mistake";

export type MistakeCategory =
  | "callingWide"
  | "overfolding"
  | "sizing"
  | "missedValue";

/** One action and its estimated value (all EVs are estimates; see analysis.rs). */
export type ActionEv = {
  action: Action;
  ev: number; // chips, relative to folding now
  foldFrequency: number | null; // bets/raises: assumed chance every opponent folds
  breakEvenFold: number | null; // bets/raises: how often a pure bluff must work
  equityWhenCalled: number | null; // bets/raises: equity against the hands that continue
};

export type Outs = {
  clean: Card[];
  dirty: Card[]; // improve you, but at least 20% of their range still beats you
  unseen: number; // 47 on the flop, 46 on the turn
  nextCard: number; // chance the next card is an out
  byRiver: number | null; // flop only: chance of hitting by the river
  ruleOfThumb: number; // Rule of 4 on the flop, Rule of 2 on the turn
};

/** Everything the math panel shows for one decision, computed by the core. */
export type DecisionAnalysis = {
  street: Street;
  hero: number;
  opponents: number;
  pot: number; // P: includes any bet you face
  toCall: number; // C
  effectiveStack: number;
  equity: EquityResult;
  potOdds: number;
  mdf: number | null; // only when facing a bet
  spr: number;
  impliedOddsNeeded: number | null; // only when facing a bet; 0 if the call already pays
  outs: Outs | null; // flop/turn, heads-up, when behind
  evByAction: ActionEv[];
};

export type AnalysisOptions = {
  equity?: Partial<EquityOptions>;
  betFractions?: number[]; // sizes as fractions of the pot after calling (default 1/3, 1/2, 3/4, 1)
  foldFrequency?: number; // override the opponent fold model
  extraActions?: Action[]; // also evaluate these, e.g. the size actually chosen
  /** Per opponent: [pot odds offered, fold frequency] points from the opponent model. */
  foldCurves?: { seat: number; points: [number, number][] }[];
};

/** An analysis graded after the player acted (hand review, Phase 8). */
export type ReviewedDecision = DecisionAnalysis & {
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
  analyses: ReviewedDecision[]; // one per hero decision
};

// The WASM API itself is typed in src/worker/protocol.ts (CoreApi).
