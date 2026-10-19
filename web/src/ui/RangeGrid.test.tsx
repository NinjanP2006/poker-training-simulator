// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCards } from "../core/cards";
import { COMBOS } from "../core/combos";
import { CELL_COMBOS } from "../core/grid";
import { RangeGrid } from "./RangeGrid";

afterEach(cleanup);

describe("RangeGrid", () => {
  it("shows all 169 hand types with live combos after blockers", () => {
    const range = new Float32Array(COMBOS).fill(1);
    render(<RangeGrid range={range} known={parseCards("As Kh 7c 2d")} />);
    expect(screen.getAllByText(/^[AKQJT2-9]{2}[so]?$/)).toHaveLength(169);
    expect(screen.getByLabelText("AA: 100% of 3 live combos (of 6)")).toBeTruthy();
    expect(screen.getByText(/About 1128 combos/)).toBeTruthy(); // C(48, 2): every combo avoiding the 4 known cards
  });

  it("reports clicks on a cell when editable", async () => {
    const onCycle = vi.fn();
    const range = new Float32Array(COMBOS);
    for (const c of CELL_COMBOS[0][1]) range[c] = 1; // AKs only
    render(<RangeGrid range={range} known={[]} onCycle={onCycle} />);
    expect(screen.getByText(/About 4 combos/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /^AKs: 100% of 4 live combos/ }));
    expect(onCycle).toHaveBeenCalledWith({ row: 0, col: 1 });
  });

  it("has no buttons when read-only", () => {
    render(<RangeGrid range={new Float32Array(COMBOS)} known={[]} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
