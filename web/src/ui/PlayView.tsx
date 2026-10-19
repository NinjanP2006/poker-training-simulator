import { useEffect } from "react";
import { HERO } from "../state/session";
import { useGame } from "../state/useGame";
import { ActionBar } from "./ActionBar";
import { CoachModeToggle, CoachPanel } from "./CoachPanel";
import { Table } from "./Table";

/** Screen 2: the table, the action bar and the math panel side by side. */
export function PlayView() {
  const hand = useGame((s) => s.hand);
  const busy = useGame((s) => s.busy);
  const error = useGame((s) => s.error);
  const revealStyles = useGame((s) => s.revealStyles);
  const setRevealStyles = useGame((s) => s.setRevealStyles);
  const heroAct = useGame((s) => s.heroAct);
  const dealNext = useGame((s) => s.dealNext);
  const leaveTable = useGame((s) => s.leaveTable);

  const complete = hand?.view.complete ?? false;

  // N or Enter deals the next hand once this one is over.
  useEffect(() => {
    if (!complete) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "n" || e.key === "N" || e.key === "Enter") && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        void dealNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [complete, dealNext]);

  if (!hand) return <main className="play">Dealing…</main>;
  const { view, config } = hand;
  const legal = view.legal;
  const heroTurn = legal?.seat === HERO;

  return (
    <main className="play">
      <header className="play-header">
        <span className="hand-no">Hand {hand.number}</span>
        <CoachModeToggle />
        <label className="check">
          <input type="checkbox" checked={revealStyles} onChange={(e) => setRevealStyles(e.target.checked)} /> Coach knows bot styles
        </label>
        <button type="button" className="link" onClick={leaveTable}>
          Leave table
        </button>
      </header>

      <div className="play-body">
        <section className="table-area" aria-label="Table">
          <Table config={config} view={view} hero={HERO} revealStyles={revealStyles} />

          <div className="below-table" aria-live="polite">
            {heroTurn && legal ? (
              <ActionBar key={view.events.length} legal={legal} pot={view.pot} currentBet={view.currentBet} bigBlind={config.bigBlind} disabled={busy} onAct={(a) => void heroAct(a)} />
            ) : complete ? (
              <div className="hand-over">
                <span>Hand complete.</span>
                <button type="button" className="primary" onClick={() => void dealNext()}>
                  Next hand <kbd>N</kbd>
                </button>
              </div>
            ) : (
              <p className="waiting">{legal ? `Bot ${legal.seat} is thinking…` : ""}</p>
            )}
            {error && <p className="error">{error}</p>}
          </div>
        </section>

        <CoachPanel />
      </div>
    </main>
  );
}
