import { useState } from "react";
import { cycleCell } from "../core/grid";
import { explainGrade } from "../explain/explain";
import { HERO } from "../state/session";
import { useGame } from "../state/useGame";
import { type CoachMode, modelLabel } from "../state/store";
import { MathPanel } from "./MathPanel";
import { RangeGrid } from "./RangeGrid";

const MODES: [CoachMode, string][] = [
  ["always", "Always"],
  ["afterActing", "After I act"],
  ["off", "Off (test)"],
];

export function CoachModeToggle() {
  const mode = useGame((s) => s.coachMode);
  const setMode = useGame((s) => s.setCoachMode);
  return (
    <div className="segmented" role="radiogroup" aria-label="When to show the math panel">
      {MODES.map(([value, label]) => (
        <button key={value} type="button" role="radio" aria-checked={mode === value} className={mode === value ? "on" : ""} onClick={() => setMode(value)}>
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * The math panel, shown according to the coach mode: on the player's turn
 * ("always"), or only once they've acted ("after I act"), or not at all.
 */
export function CoachPanel() {
  const mode = useGame((s) => s.coachMode);
  const hand = useGame((s) => s.hand);
  const analysis = useGame((s) => s.analysis);
  const lastReview = useGame((s) => s.lastReview);
  const settings = useGame((s) => s.settings);
  const revealStyles = useGame((s) => s.revealStyles);
  const overrides = useGame((s) => s.rangeOverrides);
  const setOverride = useGame((s) => s.setRangeOverride);
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);

  if (!hand) return null;
  const bigBlind = hand.config.bigBlind;
  const heroTurn = hand.view.legal?.seat === HERO;

  if (mode === "off") {
    return (
      <aside className="coach" aria-label="Math panel">
        <h2>Math panel</h2>
        <p className="muted">Coach is off: test mode. Your decisions are still graded for the hand review.</p>
      </aside>
    );
  }

  // What to show: the live decision, or the last one the player made.
  const live = heroTurn && mode === "always" && analysis.status === "ready" && analysis.analysis && analysis.ranges;
  const shown = live
    ? { analysis: analysis.analysis!, ranges: analysis.ranges!, grade: undefined, editable: true }
    : lastReview && !(heroTurn && mode === "always")
      ? { analysis: lastReview.analysis, ranges: lastReview.ranges, grade: lastReview.grade, editable: false }
      : null;

  const opponents = hand.view.players.map((p, seat) => ({ p, seat })).filter(({ p, seat }) => seat !== HERO && !p.folded).map(({ seat }) => seat);
  const seat = selectedSeat !== null && opponents.includes(selectedSeat) ? selectedSeat : opponents[0];
  const known = [...(hand.view.players[HERO].hole ?? []), ...hand.view.board];

  return (
    <aside className="coach" aria-label="Math panel" aria-busy={analysis.status === "loading"}>
      <h2>{live ? "Your decision" : shown ? "Your last decision" : "Math panel"}</h2>

      {/* On a new decision, keep the verdict on the previous one visible. */}
      {heroTurn && mode === "always" && lastReview && (
        <p className={`feedback compact ${lastReview.grade.label}`} role="status">
          Last decision: {explainGrade(lastReview.grade, bigBlind)}
        </p>
      )}

      {heroTurn && mode === "afterActing" && <p className="muted">Decide first: the numbers appear after you act.</p>}
      {heroTurn && mode === "always" && analysis.status === "loading" && <p className="muted">Working out the numbers…</p>}
      {analysis.status === "error" && <p className="error">{analysis.error}</p>}
      {!heroTurn && !shown && <p className="muted">The numbers appear when it's your turn.</p>}

      {shown && (
        <>
          <MathPanel analysis={shown.analysis} bigBlind={bigBlind} grade={shown.grade} />

          {seat !== undefined && shown.ranges[seat] && (
            <section className="ranges" aria-label="Opponent ranges">
              <h3>Estimated range</h3>
              <div className="tabs" role="tablist">
                {opponents.map((s) => (
                  <button key={s} type="button" role="tab" aria-selected={s === seat} className={s === seat ? "on" : ""} onClick={() => setSelectedSeat(s)}>
                    Bot {s}
                    {overrides[s] && " (edited)"}
                  </button>
                ))}
              </div>
              <p className="muted small">
                {overrides[seat] && shown.editable ? "Your edited range. " : `Narrowed from Bot ${seat}'s actions · model: ${modelLabel({ revealStyles, settings }, seat)}. `}
                {shown.editable && "Click a hand to change its weight (all → half → none)."}
              </p>
              <RangeGrid
                range={shown.ranges[seat]}
                known={known}
                onCycle={shown.editable ? (cell) => setOverride(seat, cycleCell(shown.ranges[seat], cell)) : undefined}
              />
              {shown.editable && overrides[seat] && (
                <button type="button" className="link" onClick={() => setOverride(seat, null)}>
                  Reset to the estimated range
                </button>
              )}
            </section>
          )}
        </>
      )}
    </aside>
  );
}
