import { type CSSProperties, useMemo } from "react";
import { type Cell, GRID_RANKS, summarizeGrid } from "../core/grid";
import type { Card } from "../core/types";
import { pct } from "../explain/format";

type Props = {
  range: Float32Array;
  /** Cards the viewer can see (their hand, the board): combos using them are blocked. */
  known: Card[];
  /** Called with a cell when clicked; omit to make the grid read-only. */
  onCycle?: (cell: Cell) => void;
};

/**
 * The 13×13 grid of hand types: pairs on the diagonal, suited hands above,
 * offsuit below. Shading shows how much of each hand type is in the range,
 * counting only combos not blocked by known cards.
 */
export function RangeGrid({ range, known, onCycle }: Props) {
  const grid = useMemo(() => summarizeGrid(range, known), [range, known]);
  const totalWeighted = grid.flat().reduce((s, c) => s + c.weighted, 0);
  const totalLive = grid.flat().reduce((s, c) => s + c.live, 0);

  return (
    <div className="range-grid-wrap">
      <p className="range-summary">
        About {Math.round(totalWeighted)} combos ({pct(totalWeighted / Math.max(1, totalLive), 0)} of possible hands)
      </p>
      <table className="range-grid" aria-label="Estimated range, 13 by 13 grid of hand types">
        <thead>
          <tr>
            <th aria-hidden="true" />
            {GRID_RANKS.split("").map((r) => (
              <th key={r} scope="col" aria-hidden="true">
                {r}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((cols, row) => (
            <tr key={row}>
              <th scope="row" aria-hidden="true">
                {GRID_RANKS[row]}
              </th>
              {cols.map((cell, col) => {
                const label = `${cell.name}: ${pct(cell.frequency, 0)} of ${cell.live} live combo${cell.live === 1 ? "" : "s"} (of ${cell.total})`;
                const style = { "--freq": cell.frequency } as CSSProperties;
                const kind = row === col ? "pair" : row < col ? "suited" : "offsuit";
                const content = <span className="cell-name">{cell.name}</span>;
                return (
                  <td key={col} className={`cell ${kind}${cell.live === 0 ? " blocked" : ""}`} style={style} title={label}>
                    {onCycle ? (
                      <button type="button" aria-label={`${label}. Click to change.`} onClick={() => onCycle({ row, col })}>
                        {content}
                      </button>
                    ) : (
                      <span aria-label={label}>{content}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
