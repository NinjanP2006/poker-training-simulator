import type { TableConfig } from "../core/types";

export type Position = "UTG" | "HJ" | "CO" | "BTN" | "SB" | "BB";

/**
 * A seat's position this hand. Heads-up, the button is also the small blind
 * and acts first preflop; it's reported as "BTN". At bigger tables, seats are
 * named back from the button (CO, HJ), and anything earlier is "UTG".
 */
export function positionOf(seat: number, config: TableConfig): Position {
  const n = config.seats.length;
  const fromButton = (seat - config.button + n) % n; // 0 = button, 1 = next seat left, ...
  if (n === 2) return fromButton === 0 ? "BTN" : "BB";
  if (fromButton === 0) return "BTN";
  if (fromButton === 1) return "SB";
  if (fromButton === 2) return "BB";
  const seatsBeforeButton = n - fromButton; // 1 = cutoff
  if (seatsBeforeButton === 1) return "CO";
  if (seatsBeforeButton === 2) return "HJ";
  return "UTG";
}
