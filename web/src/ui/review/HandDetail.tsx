import { useEffect, useMemo, useState } from "react";
import { type CompiledProfiles, type Model, populationModel, profileModel, StrengthCache } from "../../bots/model";
import { trackRanges } from "../../bots/tracker";
import type { HandHistory, HandView } from "../../core/types";
import { describeEvents } from "../../explain/events";
import { actionPastTense } from "../../explain/format";
import { grade } from "../../review/grade";
import { replaySteps } from "../../review/replay";
import { useGame } from "../../state/useGame";
import { MathPanel } from "../MathPanel";
import { RangeGrid } from "../RangeGrid";
import { Table } from "../Table";
import { LabelBadge } from "./LabelBadge";

const STREET_NAMES = { preflop: "Preflop", flop: "Flop", turn: "Turn", river: "River" } as const;

/** One saved hand: a replay you can step through, and the player's graded decisions. */
export function HandDetail({ hand, onBack }: { hand: HandHistory; onBack: () => void }) {
  const core = useGame((s) => s.core);
  const profiles = useGame((s) => s.profiles);
  const steps = useMemo(() => replaySteps(hand), [hand]);
  const lines = useMemo(() => describeEvents(hand.events, hand.heroSeat, hand.config.bigBlind), [hand]);
  const [step, setStep] = useState(0);
  const [views, setViews] = useState<Map<number, HandView>>(new Map());
  const [revealAll, setRevealAll] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const bigBlind = hand.config.bigBlind;
  const current = steps[step];

  // Rebuild the hand at the current step from its seed and events.
  useEffect(() => {
    if (views.has(current.events)) return;
    let cancelled = false;
    core.viewHand(hand.config, hand.seed, hand.events.slice(0, current.events)).then((v) => {
      if (!cancelled) setViews((m) => new Map(m).set(current.events, v));
    });
    return () => {
      cancelled = true;
    };
  }, [core, hand, current, views]);

  // Arrow keys step through the replay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "ArrowRight") setStep((s) => Math.min(steps.length - 1, s + 1));
      else if (e.key === "ArrowLeft") setStep((s) => Math.max(0, s - 1));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [steps.length]);

  const view = views.get(current.events);
  const caption = current.events === 0 || hand.events[current.events - 1].t === "deal" ? "Cards are dealt." : lines[current.events - 1];

  const jumpTo = (decision: number) => {
    setSelected(decision);
    const i = steps.findIndex((s) => s.decision === decision);
    if (i >= 0) setStep(i);
  };

  return (
    <main className="review detail">
      <button type="button" className="link" onClick={onBack}>
        ← All hands
      </button>
      <h1>
        Hand #{hand.number}{" "}
        <span className="muted small">
          {new Date(hand.playedAt).toLocaleString()} · {hand.netBb >= 0 ? "+" : "−"}
          {Math.abs(hand.netBb).toFixed(1)} BB
        </span>
      </h1>

      <div className="detail-body">
        <section aria-label="Replay">
          {view ? <Table config={hand.config} view={view} hero={hand.heroSeat} revealStyles revealAll={revealAll} /> : <div className="felt" />}
          <div className="replay-controls">
            <button type="button" onClick={() => setStep(0)} disabled={step === 0} aria-label="First step">
              ⏮
            </button>
            <button type="button" onClick={() => setStep(step - 1)} disabled={step === 0}>
              ← Back
            </button>
            <span className="step-caption" aria-live="polite">
              Step {step + 1} of {steps.length}: {caption}
              {current.decision !== null && <strong> · Your decision</strong>}
            </span>
            <button type="button" onClick={() => setStep(step + 1)} disabled={step === steps.length - 1}>
              Next →
            </button>
            <button type="button" onClick={() => setStep(steps.length - 1)} disabled={step === steps.length - 1} aria-label="Last step">
              ⏭
            </button>
          </div>
          <label className="check">
            <input type="checkbox" checked={revealAll} onChange={(e) => setRevealAll(e.target.checked)} /> Show every player's cards
          </label>
        </section>

        <section className="decisions" aria-label="Your decisions">
          <h2>Your decisions</h2>
          {hand.analyses.length === 0 && <p className="muted">You didn't have to make a decision this hand.</p>}
          <ol className="decision-list">
            {hand.analyses.map((d, i) => (
              <li key={i} className={selected === i ? "on" : ""}>
                <button type="button" onClick={() => jumpTo(i)}>
                  <span className="street">{STREET_NAMES[d.street]}</span>
                  <span>You {actionPastTense(d.chosen, bigBlind)}</span>
                  <LabelBadge label={d.label} />
                  {d.evLost > 0 && <span className="muted small">−{d.evLost.toFixed(2)} BB</span>}
                </button>
              </li>
            ))}
          </ol>
          {selected !== null && profiles && <DecisionDetail hand={hand} index={selected} profiles={profiles} />}
          <p className="note">All EVs are estimates: they count one street at a time and depend on the ranges assumed for the opponents.</p>
        </section>
      </div>
    </main>
  );
}

/** The model a seat's range was tracked with when the hand was played. */
function modelForSeat(hand: HandHistory, seat: number, profiles: CompiledProfiles): Model {
  const player = hand.config.seats[seat].player;
  return hand.revealStyles && player.kind === "bot" ? profileModel(profiles[player.profile]) : populationModel(profiles);
}

/** The full math panel for one past decision, with the ranges as they were estimated then. */
function DecisionDetail({ hand, index, profiles }: { hand: HandHistory; index: number; profiles: CompiledProfiles }) {
  const core = useGame((s) => s.core);
  const d = hand.analyses[index];
  const [ranges, setRanges] = useState<{ index: number; ranges: Float32Array[] } | null>(null);
  const [seat, setSeat] = useState<number | null>(null);
  const bigBlind = hand.config.bigBlind;

  // Rebuild the ranges by replaying the opponents' actions up to this decision.
  useEffect(() => {
    let cancelled = false;
    const events = hand.events.slice(0, d.eventIndex);
    const modelFor = (s: number) => modelForSeat(hand, s, profiles);
    trackRanges(core, hand.config, hand.seed, events, modelFor, new StrengthCache(core), { viewer: hand.heroSeat }).then((r) => {
      if (!cancelled) setRanges({ index, ranges: r });
    });
    return () => {
      cancelled = true;
    };
  }, [core, hand, d, index, profiles]);

  const before = hand.events.slice(0, d.eventIndex);
  // Opponents still in the hand at this decision.
  const folded = new Set(before.flatMap((e) => (e.t === "act" && e.action.kind === "fold" ? [e.seat] : [])));
  const opponents = hand.config.seats.map((_, s) => s).filter((s) => s !== hand.heroSeat && !folded.has(s));
  const shownSeat = seat !== null && opponents.includes(seat) ? seat : opponents[0];
  const heroDeal = hand.events.find((e) => e.t === "deal" && e.seat === hand.heroSeat);
  const known = [...(heroDeal?.t === "deal" ? heroDeal.cards : []), ...before.flatMap((e) => (e.t === "board" ? e.cards : []))];
  const current = ranges?.index === index ? ranges.ranges : null;

  return (
    <div className="decision-detail">
      {/* MathPanel shows the verdict itself when given the grade. */}
      <MathPanel analysis={d} bigBlind={bigBlind} grade={grade(d, d.chosen, bigBlind)} />
      <h3>Estimated ranges at this point</h3>
      <div className="tabs" role="tablist">
        {opponents.map((s) => (
          <button key={s} type="button" role="tab" aria-selected={s === shownSeat} className={s === shownSeat ? "on" : ""} onClick={() => setSeat(s)}>
            Bot {s}
          </button>
        ))}
      </div>
      {current && shownSeat !== undefined ? <RangeGrid range={current[shownSeat]} known={known} /> : <p className="muted">Rebuilding ranges…</p>}
    </div>
  );
}
