import { useEffect, useRef, useState } from "react";
import { foldCurve } from "../bots/foldCurve";
import type { Model, StrengthCache } from "../bots/model";
import { comboCount, trackRanges } from "../bots/tracker";
import { cardToSymbol, isRed } from "../core/cards";
import type { Action, ActionEv, Card, DecisionAnalysis, HandView, TableConfig } from "../core/types";
import { getCore } from "../worker/core";

type Props = {
  config: TableConfig;
  seed: string;
  view: HandView;
  hero: number;
  /** The model each opponent's range is tracked with. */
  modelFor: (seat: number) => Model;
  modelLabel: (seat: number) => string;
  strengths: StrengthCache;
};

type OpponentRange = { seat: number; combos: number; label: string };

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function actionLabel(a: Action): string {
  switch (a.kind) {
    case "bet":
      return `Bet ${a.amount}`;
    case "raise":
      return `Raise to ${a.to}`;
    case "allIn":
      return "All-in";
    default:
      return a.kind[0].toUpperCase() + a.kind.slice(1);
  }
}

/**
 * The math panel for hero's decision. Opponent ranges are narrowed from their
 * actions this hand, and fold frequencies come from the same opponent model.
 */
export function AnalysisPanel({ config, seed, view, hero, modelFor, modelLabel, strengths }: Props) {
  const [analysis, setAnalysis] = useState<DecisionAnalysis | null>(null);
  const [opponents, setOpponents] = useState<OpponentRange[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ms, setMs] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    if (view.legal?.seat !== hero) return;
    const request = ++latest.current;
    (async () => {
      try {
        const core = getCore();
        const start = performance.now();
        const ranges = await trackRanges(core, config, seed, view.events, modelFor, strengths, { viewer: hero });
        const live = view.players.map((p, s) => ({ p, s })).filter(({ p, s }) => s !== hero && !p.folded).map(({ s }) => s);
        const heroCards = view.players[hero].hole ?? [];
        const boardStrengths = view.board.length >= 3 ? await strengths.get(view.board) : null;
        const foldCurves = live.map((seat) => ({
          seat,
          points: foldCurve(modelFor(seat), ranges[seat], seat, view, config, boardStrengths, [...heroCards, ...view.board]),
        }));
        const result = await core.analyze({
          config,
          seed,
          events: view.events,
          heroSeat: hero,
          ranges: live.map((seat) => ({ seat, range: ranges[seat] })),
          options: { foldCurves },
        });
        if (request === latest.current) {
          setAnalysis(result);
          setOpponents(live.map((seat) => ({ seat, combos: comboCount(ranges[seat]), label: modelLabel(seat) })));
          setMs(performance.now() - start);
          setError(null);
        }
      } catch (e) {
        if (request === latest.current) setError((e as Error).message);
      }
    })();
  }, [config, seed, view, hero, modelFor, modelLabel, strengths]);

  const best = analysis?.evByAction.reduce((a, b) => (b.ev > a.ev ? b : a));
  const bb = config.bigBlind;

  return (
    <div className="analysis" aria-live="polite">
      <h3>Math panel</h3>
      {error && <p className="error">{error}</p>}
      {analysis && (
        <>
          <ul className="opponent-ranges">
            {opponents.map((o) => (
              <li key={o.seat}>
                Seat {o.seat}: about {Math.round(o.combos)} combos ({pct(o.combos / 1326)} of hands) · {o.label}
              </li>
            ))}
          </ul>

          <dl className="metrics">
            <Metric
              label="Equity"
              value={pct(analysis.equity.equity)}
              note={analysis.equity.stdErr === null ? "exact" : `± ${pct(1.96 * analysis.equity.stdErr)}`}
            />
            <Metric label="Pot / to call" value={`${analysis.pot} / ${analysis.toCall}`} />
            <Metric label="Pot odds (equity needed)" value={analysis.toCall ? pct(analysis.potOdds) : "—"} />
            <Metric label="MDF" value={analysis.mdf === null ? "—" : pct(analysis.mdf)} />
            <Metric label="SPR" value={analysis.spr.toFixed(1)} note={`eff. stack ${analysis.effectiveStack}`} />
            <Metric
              label="Implied odds needed"
              value={analysis.impliedOddsNeeded === null ? "—" : `${Math.round(analysis.impliedOddsNeeded)} chips`}
            />
          </dl>

          {analysis.outs && <OutsView outs={analysis.outs} />}

          <table className="ev-table">
            <thead>
              <tr>
                <th scope="col">Action</th>
                <th scope="col">EV (chips)</th>
                <th scope="col">EV (BB)</th>
                <th scope="col">They fold</th>
                <th scope="col">Bluff break-even</th>
                <th scope="col">Equity if called</th>
              </tr>
            </thead>
            <tbody>
              {analysis.evByAction.map((x: ActionEv, i) => (
                <tr key={i} className={x === best ? "best" : ""}>
                  <td>
                    {actionLabel(x.action)}
                    {x === best && " ★"}
                  </td>
                  <td>{x.ev.toFixed(1)}</td>
                  <td>{(x.ev / bb).toFixed(2)}</td>
                  <td>{x.foldFrequency === null ? "" : pct(x.foldFrequency)}</td>
                  <td>{x.breakEvenFold === null ? "" : pct(x.breakEvenFold)}</td>
                  <td>{x.equityWhenCalled === null ? "" : pct(x.equityWhenCalled)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">
            EVs are estimates: this street only, then showdown. Ranges are narrowed from each opponent's actions this hand, and
            fold rates come from the same model. Computed in {ms.toFixed(0)} ms ·{" "}
            {analysis.equity.method === "exact" ? "exact equity" : "Monte Carlo equity"}.
          </p>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {value}
        {note && <span className="note"> {note}</span>}
      </dd>
    </div>
  );
}

function OutsView({ outs }: { outs: NonNullable<DecisionAnalysis["outs"]> }) {
  const count = outs.clean.length + outs.dirty.length;
  const exact = outs.byRiver ?? outs.nextCard;
  const drift = Math.abs(outs.ruleOfThumb - exact);
  return (
    <div className="outs">
      <div>
        <strong>{count} outs</strong> · next card {pct(outs.nextCard)}
        {outs.byRiver !== null && <> · by the river {pct(outs.byRiver)}</>} · Rule of {outs.byRiver !== null ? 4 : 2} says{" "}
        {pct(outs.ruleOfThumb)}
        {drift > 0.02 && <span className="note"> (the shortcut is off by {pct(drift)} here)</span>}
      </div>
      <div className="out-cards">Clean: {outs.clean.length ? outs.clean.map((c) => <MiniCard key={c} card={c} />) : "none"}</div>
      <div className="out-cards">Dirty: {outs.dirty.length ? outs.dirty.map((c) => <MiniCard key={c} card={c} />) : "none"}</div>
    </div>
  );
}

function MiniCard({ card }: { card: Card }) {
  return <span className={`mini${isRed(card) ? " red" : ""}`}>{cardToSymbol(card)}</span>;
}
