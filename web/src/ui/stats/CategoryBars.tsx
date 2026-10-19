import { useId, useState } from "react";

export type BarDatum = { label: string; value: number; detail: string };

/**
 * Horizontal bars for one measure (single series: no legend; the heading
 * names it). Sorted largest first, value at each bar's tip, a tooltip on
 * hover/focus, and a table view.
 */
export function CategoryBars({ data, unit, title }: { data: BarDatum[]; unit: string; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const titleId = useId();
  const sorted = [...data].sort((a, b) => b.value - a.value);
  const max = Math.max(...sorted.map((d) => d.value), 1e-9);

  return (
    <figure className="chart" aria-labelledby={titleId}>
      <figcaption>
        <span className="chart-title" id={titleId}>
          {title}
        </span>
        <button type="button" className="link small" onClick={() => setAsTable(!asTable)}>
          {asTable ? "Show as chart" : "Show as table"}
        </button>
      </figcaption>
      {asTable ? (
        <table className="chart-table">
          <thead>
            <tr>
              <th scope="col">Type</th>
              <th scope="col">{unit}</th>
              <th scope="col">Detail</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((d) => (
              <tr key={d.label}>
                <th scope="row">{d.label}</th>
                <td>{d.value.toFixed(2)}</td>
                <td>{d.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="bars" role="list">
          {sorted.map((d, i) => {
            const text = `${d.label}: ${d.value.toFixed(2)} ${unit}, ${d.detail}`;
            return (
              <div
                key={d.label}
                className="bar-row"
                role="listitem"
                tabIndex={0}
                aria-label={text}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              >
                <span className="bar-label">{d.label}</span>
                <span className="bar-track">
                  <span className="bar" style={{ width: d.value > 0 ? `max(${(d.value / max) * 100}%, 3px)` : 0 }} />
                  <span className="bar-value">
                    {d.value.toFixed(1)} {unit}
                  </span>
                  {hover === i && (
                    <span className="tooltip" role="tooltip">
                      <strong>
                        {d.value.toFixed(2)} {unit}
                      </strong>{" "}
                      {d.label} · {d.detail}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </figure>
  );
}
