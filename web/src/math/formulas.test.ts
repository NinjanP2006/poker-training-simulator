import { describe, expect, it } from "vitest";
import {
  bluffBreakEven,
  choose,
  equity,
  evBet,
  evCall,
  impliedOdds,
  mdf,
  outs,
  pairCombos,
  potOdds,
  spr,
  unpairedCombos,
} from "./formulas";

// Notation (from the math reference):
//   P = pot before your decision, including any bet you face
//   C = amount you must put in to call
//   B = size of a bet you make (or face, for MDF)
//   E = your equity (0–1)
//   f = how often the opponent folds to your bet (0–1)
//   o = number of outs
//
// Every expected value below comes from a worked example in the plan.
// Use toBeCloseTo for anything that isn't a whole number.

describe("potOdds", () => {
  // Worked example: pot 100, opponent bets 50 -> P = 150, C = 50 -> 25%.
  it("matches the worked example", () => {
    expect(potOdds(150, 50)).toBeCloseTo(0.25);
  });

  it("returns 0 when there is nothing to call (C = 0)", () => {
    expect(potOdds(150, 0)).toBe(0);
  });
});

describe("equity", () => {
  it("counts a heads-up tie as half a win", () => {
    expect(equity(0.52, 0.04, 2)).toBeCloseTo(0.54);
  });

  it("splits a three-way tie in thirds", () => {
    expect(equity(0.5, 0.03, 3)).toBeCloseTo(0.51);
  });
});

describe("evCall", () => {
  it("matches the worked example (E = 0.30, P = 150, C = 50)", () => {
    expect(evCall(0.3, 150, 50)).toBeCloseTo(10);
  });

  it("is exactly 0 when equity equals pot odds", () => {
    expect(evCall(potOdds(150, 50), 150, 50)).toBeCloseTo(0);
  });
});

describe("evBet", () => {
  it("matches the worked example (P = 100, B = 75, f = 0.4, E = 0.3)", () => {
    expect(evBet(100, 75, 0.4, 0.3)).toBeCloseTo(40);
  });

  it("wins the whole pot when the opponent always folds", () => {
    expect(evBet(100, 75, 1, 0)).toBeCloseTo(100);
  });
});

describe("bluffBreakEven", () => {
  it("matches the worked example (B = 75 into P = 100)", () => {
    expect(bluffBreakEven(100, 75)).toBeCloseTo(0.4286, 4);
  });

  it("makes a pure bluff break even at exactly that fold rate", () => {
    const f = bluffBreakEven(100, 75);
    expect(evBet(100, 75, f, 0)).toBeCloseTo(0);
  });
});

describe("mdf", () => {
  it("matches the worked example (P = 100 before the bet, B = 75)", () => {
    expect(mdf(100, 75)).toBeCloseTo(0.5714, 4);
  });

  it("is the complement of bluff break-even", () => {
    expect(mdf(100, 75) + bluffBreakEven(100, 75)).toBeCloseTo(1);
  });
});

describe("impliedOdds", () => {
  it("matches the worked example (P = 150, C = 50, E = 0.2)", () => {
    expect(impliedOdds(150, 50, 0.2)).toBeCloseTo(50);
  });

  it("returns null when equity is 0 (no amount of future winnings helps)", () => {
    expect(impliedOdds(150, 50, 0)).toBeNull();
  });

  it("needs nothing extra when equity already equals pot odds", () => {
    expect(impliedOdds(150, 50, 0.25)).toBeCloseTo(0);
  });
});

describe("choose", () => {
  it("counts two-card boards from 47 unseen cards", () => {
    expect(choose(47, 2)).toBe(1081);
  });

  it("handles the edges", () => {
    expect(choose(5, 0)).toBe(1);
    expect(choose(5, 5)).toBe(1);
    expect(choose(2, 3)).toBe(0);
  });

  it("counts all 1,326 starting hands", () => {
    expect(choose(52, 2)).toBe(1326);
  });
});

describe("outs", () => {
  it("one card to come, 9 outs (Rule of 2 says 0.18)", () => {
    expect(outs(9, 1)).toBeCloseTo(0.1957, 4);
  });

  it("two cards to come, 9 outs (Rule of 4 says 0.36)", () => {
    expect(outs(9, 2)).toBeCloseTo(0.3497, 4);
  });

  it("Rule of 4 is close at 8 outs but drifts ~6 points high at 15", () => {
    const ruleOf4 = (o: number) => (4 * o) / 100;
    expect(Math.abs(ruleOf4(8) - outs(8, 2))).toBeLessThan(0.01);
    expect(ruleOf4(15) - outs(15, 2)).toBeGreaterThan(0.05);
  });

  it("rejects anything other than 1 or 2 cards to come", () => {
    expect(() => outs(9, 3)).toThrow();
  });
});

describe("spr", () => {
  it("matches the worked example (900 effective into 100)", () => {
    expect(spr(900, 100)).toBe(9);
  });
});

describe("combos", () => {
  it("pocket pair, unblocked -> 6", () => {
    expect(pairCombos(4)).toBe(6);
  });

  it("pocket pair, you hold one of the rank -> 3", () => {
    expect(pairCombos(3)).toBe(3);
  });

  it("unpaired, unblocked -> 16 (4 suited + 12 offsuit)", () => {
    expect(unpairedCombos(4, 4)).toBe(16);
  });

  it("unpaired, A held and K on board -> 9", () => {
    expect(unpairedCombos(3, 3)).toBe(9);
  });
});
