// The contract between the UI (main thread) and the core (Web Worker).

import type {
  Action,
  AnalysisOptions,
  Card,
  DecisionAnalysis,
  EquityOptions,
  EquityResult,
  HandEvent,
  HandView,
  Range,
  TableConfig,
} from "../core/types";

export type EquityRequest = {
  hero: [Card, Card];
  villain: Range;
  board: Card[];
  dead?: Card[];
  options?: Partial<EquityOptions>;
};

export type AnalysisRequest = {
  config: TableConfig;
  seed: string;
  events: HandEvent[];
  heroSeat: number;
  /** A range for each opponent still in the pot. */
  ranges: { seat: number; range: Range }[];
  options?: AnalysisOptions;
};

/**
 * Everything the core can do. Inside the worker these run synchronously; the
 * UI calls them through `createCore()`, which makes each one return a Promise.
 *
 * Hands are passed as plain data (config, seed, events): the worker rebuilds
 * the hand by replaying the events on every call.
 */
export interface CoreApi {
  /** Builds lookup tables; returns how long it took (ms). */
  warmUp(): number;
  newHand(config: TableConfig, seed: string): HandView;
  /** Throws if the action is illegal. */
  applyAction(config: TableConfig, seed: string, events: HandEvent[], action: Action): HandView;
  viewHand(config: TableConfig, seed: string, events: HandEvent[]): HandView;
  /** Scores 5–7 cards; higher wins. */
  evaluate(cards: Card[]): number;
  equity(request: EquityRequest): EquityResult;
  /** Every math-panel number for hero's current decision. Throws if it isn't hero's turn. */
  analyze(request: AnalysisRequest): DecisionAnalysis;
  parseRange(notation: string): Range;
  rangeToNotation(range: Range): string;
  /** 7-card evaluations per second inside the worker. */
  evalThroughput(hands: number): number;
}

export type Method = keyof CoreApi;

export type WorkerRequest = { id: number; method: Method; args: unknown[] };

export type WorkerResponse =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string };
