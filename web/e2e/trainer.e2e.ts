// The trainer end to end, in a real browser against the production build:
// play a hand, review it, check the stats, and scan every screen for
// accessibility problems.

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

/** Fails with a readable list if axe finds any accessibility violations. */
async function expectAccessible(page: Page, screen: string) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const summary = violations.map(
    (v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.map((n) => `${n.target.join(" ")}${n.failureSummary ? ` [${n.failureSummary.split("\n").slice(-1)[0].trim()}]` : ""}`).join("; ")}`,
  );
  expect(summary, `accessibility violations on ${screen}`).toEqual([]);
}

async function sitDown(page: Page, preset: RegExp) {
  await page.goto("/");
  await page.getByRole("radio", { name: preset }).click();
  await expect(page.getByRole("button", { name: "Sit down" })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole("button", { name: "Sit down" }).click();
  await expect(page.getByLabel("Poker table")).toBeVisible();
}

/** Waits for the player's turn (with the math panel ready) or the end of the hand. Returns true if it's the player's turn. */
async function nextStop(page: Page): Promise<boolean> {
  await page.waitForFunction(
    () => document.body.innerText.includes("Hand complete.") || (document.querySelector('[aria-label="Your actions"]') && document.querySelector(".coach .ev-table")),
    null,
    { timeout: 30_000 },
  );
  return (await page.getByText("Hand complete.").count()) === 0;
}

/** Plays the current hand to the end, checking or calling. */
async function playHand(page: Page, onPlayerTurn?: () => Promise<void>) {
  for (let i = 0; i < 40; i++) {
    if (!(await nextStop(page))) return;
    await onPlayerTurn?.();
    const actions = page.getByRole("group", { name: "Your actions" });
    const call = actions.getByRole("button", { name: /^Call/ });
    await ((await call.count()) ? call : actions.getByRole("button", { name: /^Check/ })).click();
  }
  throw new Error("hand never finished");
}

test("setup screen is accessible", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Poker Trainer", level: 1 })).toBeVisible();
  await expectAccessible(page, "table setup");
});

test("play a hand, review it, and see the stats update", async ({ page }) => {
  await sitDown(page, /Heads-up vs a balanced reg/);

  // Play hands until the player has made at least one graded decision.
  let scannedPlayView = false;
  let handsPlayed = 0;
  for (; handsPlayed < 8; ) {
    await playHand(page, async () => {
      if (!scannedPlayView) {
        scannedPlayView = true;
        await expectAccessible(page, "play view with the math panel");
      }
    });
    handsPlayed++;
    if (scannedPlayView && handsPlayed >= 2) break;
    await page.getByRole("button", { name: /Next hand/ }).click();
    await expect(page.getByText(`Hand ${handsPlayed + 1}`, { exact: true })).toBeVisible();
  }

  // Saved hands survive a reload.
  await page.reload();
  await page.getByRole("button", { name: "Review" }).click();
  const rows = page.locator(".hand-list tbody tr");
  await expect(rows).toHaveCount(handsPlayed);
  await expectAccessible(page, "hand list");

  // Open a hand where the player made a decision, and step through it.
  const reviewed = rows.filter({ has: page.locator(".label-badge") }).first();
  await reviewed.getByRole("button", { name: "Review" }).click();
  await expect(page.getByText(/Step 1 of \d+: Cards are dealt\./)).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText(/Step 2 of/)).toBeVisible();
  await page.getByRole("region", { name: "Your decisions" }).getByRole("listitem").first().getByRole("button").click();
  await expect(page.locator(".decision-detail .ev-table")).toBeVisible();
  await expect(page.locator(".decision-detail .range-grid")).toBeVisible({ timeout: 15_000 });
  await expectAccessible(page, "hand review");

  // Stats count every hand.
  await page.getByRole("button", { name: "Stats" }).click();
  const handsTile = page.locator(".tile").filter({ hasText: "Hands played" });
  await expect(handsTile.locator(".tile-value")).toHaveText(String(handsPlayed));
  await expect(page.getByRole("figure", { name: "EV lost by kind of error" })).toBeVisible();
  await expectAccessible(page, "stats");
});

test("screen readers hear what happens and land on each new screen", async ({ page }) => {
  await sitDown(page, /Heads-up vs a balanced reg/);
  // Actions and board cards are announced in a live region. If the player
  // acts first, act so there's something to announce.
  if (await nextStop(page)) await page.keyboard.press("c");
  const live = page.locator('main p.visually-hidden[aria-live="polite"]');
  await expect(live).toHaveText(/^(You (call|check|raise|bet|fold|go)|Bot 1 (calls|checks|raises|bets|folds|goes)|Flop|Turn|River|.* wins? )/, {
    timeout: 30_000,
  });
  // Switching screens moves focus to the new heading.
  await page.getByRole("button", { name: "Stats" }).click();
  await expect(page.getByRole("heading", { name: "Stats", level: 1 })).toBeFocused();
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByRole("heading", { name: "Hand review", level: 1 })).toBeFocused();
});

test("every action has a keyboard shortcut", async ({ page }) => {
  await sitDown(page, /Heads-up vs a balanced reg/);
  for (let hand = 0; hand < 6; hand++) {
    if (await nextStop(page)) {
      const before = await page.locator(".seat.hero .seat-status").textContent();
      await page.keyboard.press("c"); // check or call
      await expect(page.locator(".seat.hero .seat-status")).not.toHaveText(before ?? "", { timeout: 10_000 });
      await expect(page.locator(".coach .feedback").first()).toBeVisible();
      return;
    }
    await page.keyboard.press("n"); // next hand
    await expect(page.getByText(`Hand ${hand + 2}`, { exact: true })).toBeVisible();
  }
  throw new Error("never got a turn to act");
});
