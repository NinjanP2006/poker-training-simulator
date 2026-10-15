import type { Card } from "./types";

// Same encoding as the Rust core: card = rank * 4 + suit,
// rank 0 = deuce … 12 = ace, suit 0 = clubs, 1 = diamonds, 2 = hearts, 3 = spades.
const RANKS = "23456789TJQKA";
const SUITS = "cdhs";
const SUIT_SYMBOLS = ["♣", "♦", "♥", "♠"];

export const rankOf = (card: Card): number => card >> 2;
export const suitOf = (card: Card): number => card & 3;

/** "As" → 51. Case-insensitive. Throws on anything that isn't a card. */
export function parseCard(text: string): Card {
  const t = text.trim();
  const rank = RANKS.indexOf(t[0]?.toUpperCase() ?? "");
  const suit = SUITS.indexOf(t[1]?.toLowerCase() ?? "");
  if (t.length !== 2 || rank < 0 || suit < 0) {
    throw new Error(`"${text}" is not a card (expected rank + suit, like As or Td)`);
  }
  return rank * 4 + suit;
}

/** "As Kd", "AsKd" or "As,Kd" → [51, 45]. Throws on bad or duplicate cards. */
export function parseCards(text: string): Card[] {
  const compact = text.replace(/[\s,]+/g, "");
  if (compact.length % 2 !== 0) {
    throw new Error(`"${text}" doesn't split into whole cards`);
  }
  const cards: Card[] = [];
  for (let i = 0; i < compact.length; i += 2) {
    cards.push(parseCard(compact.slice(i, i + 2)));
  }
  if (new Set(cards).size !== cards.length) {
    throw new Error(`"${text}" repeats a card`);
  }
  return cards;
}

/** 51 → "As". */
export function cardToString(card: Card): string {
  return RANKS[rankOf(card)] + SUITS[suitOf(card)];
}

/** 51 → "A♠", for display. */
export function cardToSymbol(card: Card): string {
  return RANKS[rankOf(card)] + SUIT_SYMBOLS[suitOf(card)];
}

/** Diamonds and hearts are red. */
export const isRed = (card: Card): boolean => suitOf(card) === 1 || suitOf(card) === 2;
