// Table setup: what the player chooses before sitting down, and presets for
// common study setups.

import type { BotProfile, TableConfig } from "../core/types";

/** The player always sits in seat 0. */
export const HERO = 0;
export const SMALL_BLIND = 1;
export const BIG_BLIND = 2;

export type TableSize = 2 | 6;

export type SessionSettings = {
  tableSize: TableSize;
  /** Every hand starts with stacks topped up to this many big blinds. */
  stackBb: number;
  /** Bot styles for seats 1, 2, … (length tableSize − 1). */
  lineup: BotProfile[];
};

export const MIN_STACK_BB = 20;
export const MAX_STACK_BB = 250;

export type Preset = { id: string; name: string; description: string; settings: SessionSettings };

export const PRESETS: Preset[] = [
  {
    id: "6max-mixed",
    name: "6-max, 100 BB, mixed opponents",
    description: "One of each style plus an extra reg: the everyday study table.",
    settings: { tableSize: 6, stackBb: 100, lineup: ["balancedReg", "looseAggressive", "tightPassive", "callingStation", "balancedReg"] },
  },
  {
    id: "hu-reg",
    name: "Heads-up vs a balanced reg",
    description: "Every hand is played, in and out of position, against standard ranges.",
    settings: { tableSize: 2, stackBb: 100, lineup: ["balancedReg"] },
  },
  {
    id: "6max-stations",
    name: "Value-bet practice vs calling stations",
    description: "Stations call too much: practice betting thinner for value and bluffing less.",
    settings: { tableSize: 6, stackBb: 100, lineup: ["callingStation", "callingStation", "callingStation", "callingStation", "callingStation"] },
  },
  {
    id: "6max-short",
    name: "6-max short stacks, 40 BB",
    description: "Low SPRs: more all-in decisions, and top pair gets it in more often.",
    settings: { tableSize: 6, stackBb: 40, lineup: ["balancedReg", "looseAggressive", "tightPassive", "callingStation", "balancedReg"] },
  },
  {
    id: "hu-lag",
    name: "Heads-up vs a loose-aggressive player",
    description: "Face constant pressure: practice defending and spotting bluffs.",
    settings: { tableSize: 2, stackBb: 100, lineup: ["looseAggressive"] },
  },
];

/** The engine's table config for one hand. */
export function tableConfig(settings: SessionSettings, button: number): TableConfig {
  const stack = settings.stackBb * BIG_BLIND;
  return {
    seats: [
      { player: { kind: "hero" }, stack },
      ...settings.lineup.map((profile) => ({ player: { kind: "bot" as const, profile }, stack })),
    ],
    smallBlind: SMALL_BLIND,
    bigBlind: BIG_BLIND,
    button,
  };
}

/** Resizes a lineup for a new table size, keeping existing choices. */
export function resizeLineup(lineup: BotProfile[], tableSize: TableSize): BotProfile[] {
  const fill: BotProfile[] = ["balancedReg", "looseAggressive", "tightPassive", "callingStation", "balancedReg"];
  return Array.from({ length: tableSize - 1 }, (_, i) => lineup[i] ?? fill[i]);
}

/** A random 64-bit seed as a decimal string (JavaScript numbers can't hold every u64). */
export function randomSeed(): string {
  const [hi, lo] = crypto.getRandomValues(new Uint32Array(2));
  return ((BigInt(hi) << 32n) | BigInt(lo)).toString();
}
