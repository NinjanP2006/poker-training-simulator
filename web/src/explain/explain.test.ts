import { describe, expect, it } from "vitest";
import { grade } from "../review/grade";
import { checkedToAnalysis, facingBetAnalysis } from "../test/fixtures";
import { explainDecision, explainGrade } from "./explain";
import { actionLabel, bb, signedBb } from "./format";

const BB = 2;

describe("explanations", () => {
  it("reproduces the plan's example for a fold", () => {
    const e = explainDecision(facingBetAnalysis(), BB);
    expect(e.headline).toBe("Fold. You need 25.0% equity to call and have about 18.0%.");
    expect(e.points[0]).toBe(
      "You need 25.0% equity to call and have about 18.0%. Even counting future streets, you'd need to win 60 BB more when you hit.",
    );
  });

  it("explains outs, including dirty ones and the shortcut", () => {
    const e = explainDecision(facingBetAnalysis(), BB);
    const outs = e.points.find((p) => p.includes("outs"))!;
    expect(outs).toContain("You have 9 outs (1 dirty");
    expect(outs).toContain("19.1% to hit on the next card, 35.0% by the river. The Rule of 4 says 36.0%.");
    expect(outs).not.toContain("overstates");
  });

  it("warns when the Rule of 4 overstates a big draw", () => {
    const base = facingBetAnalysis();
    const many = Array.from({ length: 15 }, (_, i) => i + 3);
    const e = explainDecision({ ...base, outs: { ...base.outs!, clean: many, dirty: [] } }, BB);
    expect(e.points.join(" ")).toContain("overstates your chances");
  });

  it("mentions MDF when facing a bet and skips implied odds on the river", () => {
    const e = explainDecision(facingBetAnalysis({ street: "river", outs: null }), BB);
    expect(e.points.join(" ")).toContain("defending at least 66.7% of your hands");
    expect(e.points[0]).not.toContain("future streets");
  });

  it("explains a value bet when checked to, with fold equity and SPR", () => {
    const e = explainDecision(checkedToAnalysis(), BB);
    expect(e.headline).toBe("Bet 13 BB. It's the most profitable option by the estimates below.");
    expect(e.points[0]).toBe("Nobody has bet. Your equity is about 78.0% against your opponent's estimated range.");
    expect(e.points.join(" ")).toContain("should win the pot right away about 35.0% of the time; a pure bluff that size needs 39.0%");
    expect(e.points.join(" ")).toContain("stack-to-pot ratio of 1.5");
  });

  it("says when a call pays on its own", () => {
    const e = explainDecision(
      facingBetAnalysis({
        equity: { ...facingBetAnalysis().equity, equity: 0.4 },
        evByAction: [
          { action: { kind: "fold" }, ev: 0, foldFrequency: null, breakEvenFold: null, equityWhenCalled: null },
          { action: { kind: "call" }, ev: 30, foldFrequency: null, breakEvenFold: null, equityWhenCalled: null },
        ],
      }),
      BB,
    );
    expect(e.headline).toBe("Call. Your 40.0% equity beats the 25.0% you need.");
    expect(e.points[0]).toContain("so calling pays on its own");
  });
});

describe("grade feedback", () => {
  it("calls the best action fine", () => {
    const g = grade(facingBetAnalysis(), { kind: "fold" }, BB);
    expect(explainGrade(g, BB)).toBe("You folded: the best option by the estimates.");
  });

  it("flags a bad call as a mistake with the EV lost and a tip", () => {
    const g = grade(facingBetAnalysis(), { kind: "call" }, BB); // 14 chips = 7 BB worse than folding
    expect(explainGrade(g, BB)).toBe(
      "You called: a mistake. Fold was worth about 7.00 BB more (estimated). Your equity wasn't enough for the price.",
    );
  });

  it("flags checking a value hand as missed value", () => {
    const g = grade(checkedToAnalysis(), { kind: "check" }, BB); // 5.2 chips = 2.6 BB
    expect(explainGrade(g, BB)).toContain("a mistake. Bet 13 BB was worth about 2.60 BB more");
    expect(explainGrade(g, BB)).toContain("Betting or raising would have earned more here.");
  });
});

describe("formatting", () => {
  it("shows amounts in big blinds", () => {
    expect(bb(25, 2)).toBe("12.5 BB");
    expect(bb(200, 2)).toBe("100 BB");
    expect(signedBb(-0.8, 2)).toBe("−0.40 BB");
    expect(signedBb(3, 2)).toBe("+1.50 BB");
    expect(actionLabel({ kind: "raise", to: 12 }, 2)).toBe("Raise to 6 BB");
  });
});
