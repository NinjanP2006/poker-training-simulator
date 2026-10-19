// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { CategoryBars } from "./CategoryBars";
import { TrendChart } from "./TrendChart";

afterEach(cleanup);

const bars = [
  { label: "Missed value", value: 1.2, detail: "2 decisions" },
  { label: "Calling too wide", value: 4.5, detail: "3 decisions" },
  { label: "Sizing", value: 0, detail: "0 decisions" },
];

describe("CategoryBars", () => {
  it("sorts largest first and labels each bar's value", () => {
    render(<CategoryBars title="EV lost" unit="BB" data={bars} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual([
      "Calling too wide: 4.50 BB, 3 decisions",
      "Missed value: 1.20 BB, 2 decisions",
      "Sizing: 0.00 BB, 0 decisions",
    ]);
    expect(within(rows[0]).getByText("4.5 BB")).toBeTruthy();
  });

  it("shows a tooltip on focus and offers a table view", async () => {
    render(<CategoryBars title="EV lost" unit="BB" data={bars} />);
    fireEvent.focus(screen.getAllByRole("listitem")[1]);
    expect(screen.getByRole("tooltip").textContent).toContain("Missed value · 2 decisions");
    await userEvent.click(screen.getByRole("button", { name: "Show as table" }));
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByRole("rowheader", { name: "Calling too wide" })).toBeTruthy();
  });
});

describe("TrendChart", () => {
  const points = [
    { label: "Session 1", value: 12.5, detail: "40 hands" },
    { label: "Session 2", value: 8, detail: "55 hands" },
    { label: "Session 3", value: 5.25, detail: "61 hands" },
  ];

  it("describes every point for screen readers and labels the last one", () => {
    render(<TrendChart title="Mistakes per 100 hands" unit="per 100" points={points} />);
    const chart = screen.getByRole("img");
    expect(chart.getAttribute("aria-label")).toBe("Mistakes per 100 hands. Session 1: 12.5; Session 2: 8.0; Session 3: 5.3");
    expect(chart.querySelector(".end-label")!.textContent).toBe("5.3");
  });

  it("moves a crosshair with the arrow keys, with a tooltip for the session", () => {
    render(<TrendChart title="Mistakes per 100 hands" unit="per 100" points={points} />);
    const chart = screen.getByRole("img");
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(screen.getByRole("tooltip").textContent).toContain("Session 1 · 40 hands");
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(screen.getByRole("tooltip").textContent).toContain("Session 2");
    expect(chart.querySelector(".crosshair")).toBeTruthy();
  });

  it("has a table view", async () => {
    render(<TrendChart title="Mistakes per 100 hands" unit="per 100" points={points} />);
    await userEvent.click(screen.getByRole("button", { name: "Show as table" }));
    expect(screen.getAllByRole("row")).toHaveLength(4);
  });
});
