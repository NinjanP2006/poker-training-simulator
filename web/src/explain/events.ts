// Plain-language descriptions of hand events, for the replay.

import { cardToSymbol } from "../core/cards";
import type { HandEvent } from "../core/types";
import { bb } from "./format";

export const seatName = (seat: number, hero: number) => (seat === hero ? "You" : `Bot ${seat}`);

/** "Bot 3 raises to 3 BB", "Flop: 8♥ Q♦ 4♦", "You win 12 BB from the main pot". */
export function describeEvent(e: HandEvent, hero: number, bigBlind: number, boardsBefore: number): string {
  const you = (seat: number) => seat === hero;
  const who = (seat: number) => seatName(seat, hero);
  const verb = (seat: number, base: string, third: string) => (you(seat) ? base : third);
  switch (e.t) {
    case "blind":
      return `${who(e.seat)} ${verb(e.seat, "post", "posts")} ${bb(e.amount, bigBlind)}`;
    case "deal":
      return you(e.seat) ? `You are dealt ${e.cards.map(cardToSymbol).join(" ")}` : `${who(e.seat)} is dealt two cards`;
    case "board":
      return `${["Flop", "Turn", "River"][boardsBefore] ?? "Board"}: ${e.cards.map(cardToSymbol).join(" ")}`;
    case "award":
      return `${who(e.seat)} ${verb(e.seat, "win", "wins")} ${bb(e.amount, bigBlind)} from the ${e.potIndex === 0 ? "main pot" : `side pot ${e.potIndex}`}`;
    case "act": {
      const a = e.action;
      switch (a.kind) {
        case "bet":
          return `${who(e.seat)} ${verb(e.seat, "bet", "bets")} ${bb(a.amount, bigBlind)}`;
        case "raise":
          return `${who(e.seat)} ${verb(e.seat, "raise", "raises")} to ${bb(a.to, bigBlind)}`;
        case "allIn":
          return `${who(e.seat)} ${verb(e.seat, "go", "goes")} all-in`;
        default:
          return `${who(e.seat)} ${verb(e.seat, a.kind, `${a.kind}s`)}`;
      }
    }
  }
}

/** Descriptions for every event, tracking which street each board card belongs to. */
export function describeEvents(events: HandEvent[], hero: number, bigBlind: number): string[] {
  let boards = 0;
  return events.map((e) => {
    const text = describeEvent(e, hero, bigBlind, boards);
    if (e.t === "board") boards++;
    return text;
  });
}
