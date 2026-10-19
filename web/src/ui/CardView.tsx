import { cardName, cardToString, isRed, rankOf, suitOf } from "../core/cards";
import type { Card } from "../core/types";

const RANKS = "23456789TJQKA";
const SUITS = ["♣", "♦", "♥", "♠"];

export function CardView({ card, size = "md" }: { card: Card; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`pcard ${size}${isRed(card) ? " red" : ""} suit-${suitOf(card)}`} role="img" aria-label={cardName(card)} data-card={cardToString(card)}>
      <span className="rank">{RANKS[rankOf(card)]}</span>
      <span className="suit">{SUITS[suitOf(card)]}</span>
    </span>
  );
}

export function CardBack({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  return <span className={`pcard back ${size}`} role="img" aria-label="face-down card" />;
}
