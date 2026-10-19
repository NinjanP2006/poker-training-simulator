// @vitest-environment jsdom
// Play hands, then review one and check the stats, all through the UI with
// the real core and an in-memory IndexedDB.

import "fake-indexeddb/auto";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import App from "../App";
import { GameProvider } from "../state/GameContext";
import { createGameStore } from "../state/store";
import { TrainerDb } from "../storage/db";
import { createRepository } from "../storage/repo";
import { wasmCore } from "../test/wasmCore";

afterEach(cleanup);

async function playHand(user: ReturnType<typeof userEvent.setup>) {
  for (let step = 0; step < 40; step++) {
    await waitFor(
      () => {
        const done = screen.queryByText("Hand complete.");
        const ready = screen.queryByRole("group", { name: "Your actions" }) && screen.queryByRole("table", { name: /Estimated EV/ });
        if (!done && !ready) throw new Error("not yet");
      },
      { timeout: 15_000 },
    );
    if (screen.queryByText("Hand complete.")) return;
    const actions = screen.getByRole("group", { name: "Your actions" });
    await user.click(within(actions).queryByRole("button", { name: /^Call/ }) ?? within(actions).getByRole("button", { name: /^Check/ }));
  }
  throw new Error("hand never finished");
}

describe("review and stats", () => {
  it("saves played hands, replays one with its decisions, and counts them in stats", async () => {
    const user = userEvent.setup();
    const repo = createRepository(new TrainerDb(`ui-${crypto.randomUUID()}`));
    const store = createGameStore({ core: wasmCore(), repo, botDelayMs: 0 });
    render(
      <GameProvider store={store}>
        <App />
      </GameProvider>,
    );

    await user.click(await screen.findByRole("radio", { name: /Heads-up vs a balanced reg/ }));
    const sit = screen.getByRole("button", { name: "Sit down" });
    await waitFor(() => expect((sit as HTMLButtonElement).disabled).toBe(false));
    await user.click(sit);

    // Play until at least one saved hand has a decision to review.
    let played = 0;
    while (played < 6) {
      await playHand(user);
      played++;
      await waitFor(() => expect(store.getState().savedHands).toBe(played));
      if ((await repo.listDecisions()).length > 0 && played >= 2) break;
      await user.click(screen.getByRole("button", { name: /Next hand/ }));
    }

    // Review: the list shows every hand; open one with a decision.
    await user.click(screen.getByRole("button", { name: "Review" }));
    const list = await screen.findByRole("table");
    const rows = within(list).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(played);
    const withDecision = rows.find((r) => within(r).queryAllByText(/fine|marginal|mistake/).length > 0);
    await user.click(within(withDecision!).getByRole("button", { name: "Review" }));

    // The replay steps through the hand, and decisions open the full math panel.
    expect(await screen.findByText(/Step 1 of \d+: Cards are dealt\./)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Next →/ }));
    expect(screen.getByText(/Step 2 of/)).toBeTruthy();
    const decisions = screen.getByRole("region", { name: "Your decisions" });
    await user.click(within(decisions).getAllByRole("listitem")[0].querySelector("button")!);
    expect(await within(decisions).findByRole("table", { name: /Estimated EV/ })).toBeTruthy();
    expect(screen.getByText(/· Your decision/)).toBeTruthy(); // the replay jumped to it
    await waitFor(() => expect(within(decisions).getByLabelText(/Estimated range/)).toBeTruthy(), { timeout: 10_000 });

    // Stats: every hand counted, every decision graded.
    await user.click(screen.getByRole("button", { name: "Stats" }));
    const handsTile = (await screen.findByText("Hands played")).parentElement!;
    expect(within(handsTile).getByText(String(played))).toBeTruthy();
    const decisionRows = await repo.listDecisions();
    const gradedTile = screen.getByText("Decisions graded").parentElement!;
    expect(within(gradedTile).getByText(String(decisionRows.length))).toBeTruthy();
    expect(screen.getByRole("figure", { name: /EV lost by kind of error/ })).toBeTruthy();
  }, 90_000);
});
