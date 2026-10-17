import { describe, expect, it } from "vitest";
import type { TableConfig } from "../core/types";
import { positionOf } from "./positions";

const table = (seats: number, button: number): TableConfig => ({
  seats: Array.from({ length: seats }, () => ({ player: { kind: "hero" as const }, stack: 200 })),
  smallBlind: 1,
  bigBlind: 2,
  button,
});

describe("positions", () => {
  it("names the six 6-max positions from the button", () => {
    const config = table(6, 3);
    expect([4, 5, 0, 1, 2, 3].map((s) => positionOf(s, config))).toEqual(["SB", "BB", "UTG", "HJ", "CO", "BTN"]);
  });

  it("heads-up has a button (who posts the small blind) and a big blind", () => {
    const config = table(2, 1);
    expect(positionOf(1, config)).toBe("BTN");
    expect(positionOf(0, config)).toBe("BB");
  });

  it("smaller tables drop the early positions", () => {
    expect([0, 1, 2].map((s) => positionOf(s, table(3, 0)))).toEqual(["BTN", "SB", "BB"]);
    expect([0, 1, 2, 3].map((s) => positionOf(s, table(4, 0)))).toEqual(["BTN", "SB", "BB", "CO"]);
  });
});
