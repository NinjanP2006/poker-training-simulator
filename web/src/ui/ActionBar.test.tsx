// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LegalActions } from "../core/types";
import { ActionBar } from "./ActionBar";

afterEach(cleanup);

const facingBet: LegalActions = { seat: 0, toCall: 10, callIsAllIn: false, minRaiseTo: 30, maxRaiseTo: 200, isBet: false };
const checkedTo: LegalActions = { seat: 0, toCall: 0, callIsAllIn: false, minRaiseTo: 2, maxRaiseTo: 200, isBet: true };

describe("ActionBar", () => {
  it("offers fold, call and raise when facing a bet", async () => {
    const onAct = vi.fn();
    render(<ActionBar legal={facingBet} pot={30} currentBet={20} bigBlind={2} onAct={onAct} />);
    await userEvent.click(screen.getByRole("button", { name: /^Fold/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Call 5 BB/ }));
    expect(onAct.mock.calls).toEqual([[{ kind: "fold" }], [{ kind: "call" }]]);
  });

  it("offers check and bet when checked to, with no fold button", () => {
    render(<ActionBar legal={checkedTo} pot={20} currentBet={0} bigBlind={2} onAct={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /^Fold/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Check/ })).toBeTruthy();
    // Default size is half the pot: 10 chips = 5 BB.
    expect(screen.getByRole("button", { name: /^Bet 5 BB/ })).toBeTruthy();
  });

  it("sizes with presets and bets the chosen amount", async () => {
    const onAct = vi.fn();
    render(<ActionBar legal={checkedTo} pot={20} currentBet={0} bigBlind={2} onAct={onAct} />);
    await userEvent.click(screen.getByRole("button", { name: "Pot" }));
    await userEvent.click(screen.getByRole("button", { name: /^Bet 10 BB/ }));
    expect(onAct).toHaveBeenCalledWith({ kind: "bet", amount: 20 });
  });

  it("raises to the chosen total, and turns the maximum into all-in", async () => {
    const onAct = vi.fn();
    render(<ActionBar legal={facingBet} pot={30} currentBet={20} bigBlind={2} onAct={onAct} />);
    await userEvent.click(screen.getByRole("button", { name: "Min" }));
    await userEvent.click(screen.getByRole("button", { name: /^Raise to 15 BB/ }));
    await userEvent.click(screen.getByRole("button", { name: /^All-in/ }));
    await userEvent.click(screen.getByRole("button", { name: /^All-in R/ }));
    expect(onAct.mock.calls).toEqual([[{ kind: "raise", to: 30 }], [{ kind: "allIn" }]]);
  });

  it("answers keyboard shortcuts", async () => {
    const onAct = vi.fn();
    render(<ActionBar legal={facingBet} pot={30} currentBet={20} bigBlind={2} onAct={onAct} />);
    await userEvent.keyboard("c");
    await userEvent.keyboard("f");
    await userEvent.keyboard("a");
    expect(onAct.mock.calls).toEqual([[{ kind: "call" }], [{ kind: "fold" }], [{ kind: "allIn" }]]);
  });

  it("ignores input while disabled", async () => {
    const onAct = vi.fn();
    render(<ActionBar legal={facingBet} pot={30} currentBet={20} bigBlind={2} disabled onAct={onAct} />);
    await userEvent.keyboard("c");
    expect(onAct).not.toHaveBeenCalled();
  });
});
