import type { DecisionAnalysis } from "../core/types";
import { bestAction, ESTIMATE_NOTE, explainDecision, explainGrade } from "../explain/explain";
import { actionLabel, bb, pct, sameAction, signedBb } from "../explain/format";
import type { Grade } from "../review/grade";
import { CardView } from "./CardView";

type Props = {
  analysis: DecisionAnalysis;
  bigBlind: number;
  /** Set when showing a decision the player already made. */
  grade?: Grade;
};

/** Every number from the math reference for one decision, with a plain-language explanation. */
export function MathPanel({ analysis: a, bigBlind, grade }: Props) {
  const best = bestAction(a);
  const explanation = explainDecision(a, bigBlind);
  const facingBet = a.toCall > 0;
  const e = a.equity.equity;

  return (
    <div className="math-panel">
      {grade && (
        <p className={`feedback ${grade.label}`} role="status">
          {explainGrade(grade, bigBlind)}
        </p>
      )}

      <div className="equity-row">
        <div>
          <div className="label">Equity</div>
          <div className="equity-value">
            {pct(e)}
            {a.equity.stdErr !== null && <span className="ci"> ± {pct(1.96 * a.equity.stdErr)}</span>}
          </div>
          <div className="sub">
            vs {a.opponents === 1 ? "1 opponent" : `${a.opponents} opponents`} · {a.equity.method === "exact" ? "exact" : "simulated"}
          </div>
        </div>
        {facingBet && (
          <div className="price">
            <div className="label">Equity needed (pot odds)</div>
            <div className={`equity-value ${e >= a.potOdds ? "good" : "bad"}`}>{pct(a.potOdds)}</div>
            <div className="meter" aria-hidden="true">
              <div className="fill" style={{ width: `${Math.min(100, e * 100)}%` }} />
              <div className="mark" style={{ left: `${a.potOdds * 100}%` }} />
            </div>
          </div>
        )}
      </div>

      <dl className="metric-grid">
        <div>
          <dt>Pot / to call</dt>
          <dd>
            {bb(a.pot, bigBlind)} / {facingBet ? bb(a.toCall, bigBlind) : "—"}
          </dd>
        </div>
        <div>
          <dt>MDF</dt>
          <dd>{a.mdf === null ? "—" : pct(a.mdf)}</dd>
        </div>
        <div>
          <dt>SPR</dt>
          <dd>{a.street === "preflop" ? "—" : a.spr.toFixed(1)}</dd>
        </div>
        <div>
          <dt>Implied odds needed</dt>
          <dd>{a.impliedOddsNeeded === null ? "—" : a.impliedOddsNeeded === 0 ? "none" : bb(a.impliedOddsNeeded, bigBlind)}</dd>
        </div>
      </dl>

      {a.outs && (
        <section className="outs-block" aria-label="Outs">
          <h4>
            {a.outs.clean.length + a.outs.dirty.length} outs · next card {pct(a.outs.nextCard)}
            {a.outs.byRiver !== null && <> · by river {pct(a.outs.byRiver)}</>}
          </h4>
          <p className="rule">
            Rule of {a.outs.byRiver !== null ? 4 : 2}: {pct(a.outs.ruleOfThumb)}
            {a.outs.byRiver !== null && a.outs.clean.length + a.outs.dirty.length > 12 && (
              <span className="warn"> · overstates big draws like this one</span>
            )}
          </p>
          <div className="out-row">
            <span className="tag">Clean</span>
            {a.outs.clean.length ? a.outs.clean.map((c) => <CardView key={c} card={c} size="sm" />) : <span className="none">none</span>}
          </div>
          <div className="out-row">
            <span className="tag dirty">Dirty</span>
            {a.outs.dirty.length ? a.outs.dirty.map((c) => <CardView key={c} card={c} size="sm" />) : <span className="none">none</span>}
          </div>
        </section>
      )}

      <table className="ev-table">
        <caption>Estimated EV of each option</caption>
        <thead>
          <tr>
            <th scope="col">Option</th>
            <th scope="col">EV</th>
            <th scope="col">They fold</th>
            <th scope="col">Bluff needs</th>
            <th scope="col">Equity if called</th>
          </tr>
        </thead>
        <tbody>
          {a.evByAction.map((x, i) => {
            const isBest = x === best;
            const isChosen = grade && sameAction(x.action, grade.chosen.action);
            return (
              <tr key={i} className={`${isBest ? "best" : ""}${isChosen ? " chosen" : ""}`}>
                <th scope="row">
                  {actionLabel(x.action, bigBlind)}
                  {isBest && <span className="badge">best</span>}
                  {isChosen && <span className="badge you">you</span>}
                </th>
                <td>{signedBb(x.ev, bigBlind)}</td>
                <td>{x.foldFrequency === null ? "" : pct(x.foldFrequency)}</td>
                <td>{x.breakEvenFold === null ? "" : pct(x.breakEvenFold)}</td>
                <td>{x.equityWhenCalled === null ? "" : pct(x.equityWhenCalled)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <section className="explanation" aria-label="Explanation">
        <p className="headline">{explanation.headline}</p>
        <ul>
          {explanation.points.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
        <p className="note">{ESTIMATE_NOTE}</p>
      </section>
    </div>
  );
}
