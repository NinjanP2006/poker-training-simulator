// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { grade } from "../review/grade";
import { checkedToAnalysis, facingBetAnalysis } from "../test/fixtures";
import { MathPanel } from "./MathPanel";

afterEach(cleanup);

describe("MathPanel", () => {
  it("shows equity against the equity needed, MDF, implied odds and outs", () => {
    render(<MathPanel analysis={facingBetAnalysis()} bigBlind={2} />);
    expect(screen.getByText("18.0%")).toBeTruthy(); // equity
    expect(screen.getByText("25.0%")).toBeTruthy(); // needed
    expect(screen.getByText("66.7%")).toBeTruthy(); // MDF
    expect(screen.getByText("60 BB")).toBeTruthy(); // implied odds needed
    const outs = screen.getByLabelText("Outs");
    expect(within(outs).getByText(/9 outs · next card 19\.1% · by river 35\.0%/)).toBeTruthy();
    expect(within(outs).getAllByRole("img")).toHaveLength(9); // 8 clean + 1 dirty card
  });

  it("lists every option's EV in big blinds and marks the best", () => {
    render(<MathPanel analysis={facingBetAnalysis()} bigBlind={2} />);
    const rows = within(screen.getByRole("table", { name: /Estimated EV/ })).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getByRole("rowheader").textContent)).toEqual(["Foldbest", "Call", "Raise to 100 BB", "All-in"]);
    expect(within(rows[1]).getByText("−7.00 BB")).toBeTruthy();
  });

  it("explains the decision in plain language", () => {
    render(<MathPanel analysis={facingBetAnalysis()} bigBlind={2} />);
    expect(screen.getByText("Fold. You need 25.0% equity to call and have about 18.0%.")).toBeTruthy();
    expect(screen.getByText(/you'd need to win 60 BB more when you hit/)).toBeTruthy();
    expect(screen.getByText(/EVs are estimates/)).toBeTruthy();
  });

  it("after acting, shows the grade and marks the chosen option", () => {
    const a = checkedToAnalysis();
    render(<MathPanel analysis={a} bigBlind={2} grade={grade(a, { kind: "check" }, 2)} />);
    expect(screen.getByRole("status").textContent).toContain("You checked: a mistake.");
    expect(screen.getByText("you")).toBeTruthy();
  });

  it("hides pot odds and MDF when there's nothing to call", () => {
    render(<MathPanel analysis={checkedToAnalysis()} bigBlind={2} />);
    expect(screen.queryByText(/Equity needed/)).toBeNull();
    expect(screen.getByText("1.5")).toBeTruthy(); // SPR
  });
});
