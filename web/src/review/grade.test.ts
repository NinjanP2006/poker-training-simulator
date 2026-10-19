import { describe, expect, it } from "vitest";
import { checkedToAnalysis, facingBetAnalysis } from "../test/fixtures";
import { grade, labelFor } from "./grade";

const BB = 2;

describe("grading", () => {
  it("uses the plan's thresholds: under 0.25 BB fine, up to 1 BB marginal, over that a mistake", () => {
    expect(labelFor(0)).toBe("fine");
    expect(labelFor(0.24)).toBe("fine");
    expect(labelFor(0.25)).toBe("marginal");
    expect(labelFor(1)).toBe("marginal");
    expect(labelFor(1.01)).toBe("mistake");
  });

  it("measures EV lost against the best action, in big blinds", () => {
    const g = grade(facingBetAnalysis(), { kind: "raise", to: 200 }, BB);
    expect(g.best.action).toEqual({ kind: "fold" });
    expect(g.evLostBb).toBeCloseTo(15); // 30 chips
    expect(g.label).toBe("mistake");
  });

  it("tags each kind of mistake", () => {
    const facing = facingBetAnalysis();
    expect(grade(facing, { kind: "call" }, BB).category).toBe("callingWide");
    expect(grade(facing, { kind: "raise", to: 200 }, BB).category).toBe("callingWide");

    const checked = checkedToAnalysis();
    expect(grade(checked, { kind: "check" }, BB).category).toBe("missedValue");
    expect(grade(checked, { kind: "allIn" }, BB).category).toBe("sizing"); // 2.4 chips = 1.2 BB worse

    const shouldCall = facingBetAnalysis({
      evByAction: [
        { action: { kind: "fold" }, ev: 0, foldFrequency: null, breakEvenFold: null, equityWhenCalled: null },
        { action: { kind: "call" }, ev: 10, foldFrequency: null, breakEvenFold: null, equityWhenCalled: null },
      ],
    });
    expect(grade(shouldCall, { kind: "fold" }, BB).category).toBe("overfolding");
  });

  it("leaves fine decisions untagged", () => {
    expect(grade(checkedToAnalysis(), { kind: "bet", amount: 26 }, BB).category).toBeUndefined();
  });

  it("refuses to grade an action that wasn't analysed", () => {
    expect(() => grade(checkedToAnalysis(), { kind: "bet", amount: 999 }, BB)).toThrow();
  });
});
