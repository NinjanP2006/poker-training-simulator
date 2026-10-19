import { type KeyboardEvent, type PointerEvent, useId, useRef, useState } from "react";

export type TrendPoint = { label: string; value: number; detail: string };

const W = 640;
const H = 220;
const M = { left: 40, right: 24, top: 16, bottom: 32 };

/** A clean axis maximum: 1, 2, 2.5, 5 × a power of ten at or above `v`. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= v)!;
}

/**
 * One measure over sessions, as a line (single series: the heading names it).
 * A crosshair snaps to the nearest session on hover; arrow keys move it when
 * the chart has focus. The last point is labelled; a table view holds the rest.
 */
export function TrendChart({ points, title, unit }: { points: TrendPoint[]; title: string; unit: string }) {
  const [active, setActive] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const titleId = useId();
  const svg = useRef<SVGSVGElement>(null);

  const yMax = niceMax(Math.max(...points.map((p) => p.value), 0));
  const ticks = [0, yMax / 2, yMax];
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const x = (i: number) => M.left + (points.length === 1 ? plotW / 2 : (i * plotW) / (points.length - 1));
  const y = (v: number) => M.top + plotH - (v / yMax) * plotH;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const box = svg.current!.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    points.forEach((_, i) => {
      if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    });
    setActive(best);
  };

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "ArrowRight") setActive((a) => Math.min(points.length - 1, (a ?? -1) + 1));
    else if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? points.length) - 1));
    else return;
    e.preventDefault();
  };

  const last = points.length - 1;
  const fmt = (v: number) => v.toFixed(1);

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
              <th scope="col">Session</th>
              <th scope="col">{unit}</th>
              <th scope="col">Detail</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.label}>
                <th scope="row">{p.label}</th>
                <td>{fmt(p.value)}</td>
                <td>{p.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="trend-wrap">
          <svg
            ref={svg}
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`${title}. ${points.map((p) => `${p.label}: ${fmt(p.value)}`).join("; ")}`}
            tabIndex={0}
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line className="grid" x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} />
                <text className="tick" x={M.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">
                  {fmt(t)}
                </text>
              </g>
            ))}
            {points.map((p, i) => (
              <text key={p.label} className="tick" x={x(i)} y={H - 10} textAnchor="middle">
                {points.length <= 12 || i % Math.ceil(points.length / 12) === 0 ? i + 1 : ""}
              </text>
            ))}
            <path className="trend-line" d={path} />
            {active !== null && <line className="crosshair" x1={x(active)} x2={x(active)} y1={M.top} y2={M.top + plotH} />}
            {points.map((p, i) => (
              <circle key={p.label} className="trend-dot" cx={x(i)} cy={y(p.value)} r={active === i ? 6 : 4} />
            ))}
            <text className="end-label" x={x(last) + 8} y={y(points[last].value) - 10} textAnchor="end">
              {fmt(points[last].value)}
            </text>
            <rect
              className="hit"
              x={M.left - 12}
              y={M.top}
              width={plotW + 24}
              height={plotH}
              onPointerMove={onMove}
              onPointerLeave={() => setActive(null)}
            />
          </svg>
          {active !== null && (
            <div className="tooltip trend-tooltip" role="tooltip" style={{ left: `${(x(active) / W) * 100}%`, top: `${(y(points[active].value) / H) * 100}%` }}>
              <strong>
                {fmt(points[active].value)} {unit}
              </strong>{" "}
              {points[active].label} · {points[active].detail}
            </div>
          )}
          <p className="axis-note">Session</p>
        </div>
      )}
    </figure>
  );
}
