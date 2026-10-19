// @vitest-environment jsdom
// The whole app with the real compiled core: set up a table, sit down, and
// play hands through the UI against the bots, with the math panel live.

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import App from "../App";
import { GameProvider } from "../state/GameContext";
import { createGameStore } from "../state/store";
import { wasmCore } from "../test/wasmCore";

afterEach(cleanup);

function renderApp() {
  const store = createGameStore({ core: wasmCore(), botDelayMs: 0 });
  render(
    <GameProvider store={store}>
      <App />
    </GameProvider>,
  );
  return store;
}

describe("the trainer", () => {
  it("sets up a table and plays complete hands with the math panel", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole("radio", { name: /Heads-up vs a balanced reg/ }));
    const sit = screen.getByRole("button", { name: "Sit down" });
    await waitFor(() => expect((sit as HTMLButtonElement).disabled).toBe(false));
    await user.click(sit);
    expect(await screen.findByLabelText("Poker table")).toBeTruthy();

    let panelsSeen = 0;
    for (let hand = 0; hand < 2; hand++) {
      for (let step = 0; step < 30; step++) {
        // Wait for either the player's turn (with the panel ready) or the end of the hand.
        await waitFor(
          () => {
            const done = screen.queryByText("Hand complete.");
            const ready = screen.queryByRole("group", { name: "Your actions" }) && screen.queryByRole("table", { name: /Estimated EV/ });
            if (!done && !ready) throw new Error("not yet");
          },
          { timeout: 15_000 },
        );
        if (screen.queryByText("Hand complete.")) break;

        panelsSeen++;
        const panel = screen.getByRole("complementary", { name: "Math panel" });
        expect(within(panel).getByText("Equity")).toBeTruthy();
        expect(within(panel).getByLabelText(/Estimated range/)).toBeTruthy();

        const actions = screen.getByRole("group", { name: "Your actions" });
        const call = within(actions).queryByRole("button", { name: /^Call/ });
        await user.click(call ?? within(actions).getByRole("button", { name: /^Check/ }));
        // After acting, the panel grades the decision.
        await waitFor(() => expect(within(screen.getByRole("complementary", { name: "Math panel" })).getByRole("status")).toBeTruthy());
      }
      expect(screen.getByText("Hand complete.")).toBeTruthy();
      await user.click(screen.getByRole("button", { name: /Next hand/ }));
      await waitFor(() => expect(screen.getByText(`Hand ${hand + 2}`)).toBeTruthy());
    }
    expect(panelsSeen).toBeGreaterThan(0);
  }, 60_000);

  it("in 'after I act' mode, hides the numbers until the player decides", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByRole("radio", { name: "After I act" }));
    const sit = screen.getByRole("button", { name: "Sit down" });
    await waitFor(() => expect((sit as HTMLButtonElement).disabled).toBe(false));
    await user.click(sit);

    for (let tries = 0; tries < 10; tries++) {
      await waitFor(() => {
        if (!screen.queryByText("Hand complete.") && !screen.queryByRole("group", { name: "Your actions" })) throw new Error("not yet");
      }, { timeout: 15_000 });
      if (screen.queryByRole("group", { name: "Your actions" })) break;
      await user.click(screen.getByRole("button", { name: /Next hand/ }));
    }
    const panel = screen.getByRole("complementary", { name: "Math panel" });
    expect(within(panel).getByText(/Decide first/)).toBeTruthy();
    expect(within(panel).queryByRole("table", { name: /Estimated EV/ })).toBeNull();

    const actions = screen.getByRole("group", { name: "Your actions" });
    await user.click(within(actions).queryByRole("button", { name: /^Call/ }) ?? within(actions).getByRole("button", { name: /^Check/ }));
    await waitFor(() => expect(within(screen.getByRole("complementary", { name: "Math panel" })).getByRole("table", { name: /Estimated EV/ })).toBeTruthy());
  }, 60_000);
});
