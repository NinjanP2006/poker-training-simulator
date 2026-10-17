import { useCallback, useEffect, useState } from "react";
import { decide } from "../bots/bot";
import { type CompiledProfiles, compileProfiles, type Model, populationModel, profileModel, StrengthCache } from "../bots/model";
import { PROFILES } from "../bots/profiles";
import { cardToSymbol, isRed } from "../core/cards";
import type { Action, BotProfile, Card, HandEvent, HandView, TableConfig } from "../core/types";
import { getCore } from "../worker/core";
import { AnalysisPanel } from "./AnalysisPanel";

/** A hand in progress. Board strengths are cached per hand. */
type Hand = { config: TableConfig; seed: string; view: HandView; strengths: StrengthCache };

const HERO = 0;
/** Bots in seats 1–5. */
const LINEUP: BotProfile[] = ["balancedReg", "looseAggressive", "tightPassive", "callingStation", "balancedReg"];
const STACK = 200;
const BOT_DELAY_MS = 450;

/** A random 64-bit seed as a decimal string (JavaScript numbers can't hold all u64 values). */
function randomSeed(): string {
  const [hi, lo] = crypto.getRandomValues(new Uint32Array(2));
  return ((BigInt(hi) << 32n) | BigInt(lo)).toString();
}

function tableConfig(button: number): TableConfig {
  return {
    seats: [
      { player: { kind: "hero" }, stack: STACK },
      ...LINEUP.map((profile) => ({ player: { kind: "bot" as const, profile }, stack: STACK })),
    ],
    smallBlind: 1,
    bigBlind: 2,
    button,
  };
}

const profileOf = (seat: number): BotProfile => LINEUP[seat - 1];

export function HandDemo() {
  const [hand, setHand] = useState<Hand | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [raiseTo, setRaiseTo] = useState(0);
  const [profiles, setProfiles] = useState<CompiledProfiles | null>(null);
  const [showBotCards, setShowBotCards] = useState(false);
  const [revealProfiles, setRevealProfiles] = useState(false);

  // Stable functions, so the math panel only recomputes when something it uses changes.
  const modelFor = useCallback(
    (seat: number): Model => (revealProfiles ? profileModel(profiles![profileOf(seat)]) : populationModel(profiles!)),
    [revealProfiles, profiles],
  );
  const modelLabel = useCallback(
    (seat: number) => (revealProfiles ? PROFILES[profileOf(seat)].name : "population average (style unknown)"),
    [revealProfiles],
  );

  useEffect(() => {
    compileProfiles(getCore()).then(setProfiles, (e: Error) => setError(e.message));
  }, []);

  function update(next: Hand) {
    setHand(next);
    setRaiseTo(next.view.legal?.minRaiseTo ?? 0);
    setError(null);
  }

  async function deal() {
    const button = hand ? (hand.config.button + 1) % (LINEUP.length + 1) : 0;
    const config = tableConfig(button);
    const seed = randomSeed();
    try {
      update({ config, seed, view: await getCore().newHand(config, seed), strengths: new StrengthCache(getCore()) });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function act(action: Action) {
    if (!hand) return;
    try {
      update({ ...hand, view: await getCore().applyAction(hand.config, hand.seed, hand.view.events, action) });
    } catch (e) {
      setError((e as Error).message); // the engine explains why an action is illegal
    }
  }

  // When it's a bot's turn, let it decide after a short pause.
  useEffect(() => {
    const legal = hand?.view.legal;
    if (!hand || !legal || legal.seat === HERO || !profiles) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { action } = await decide(profiles[profileOf(legal.seat)], hand.config, hand.seed, hand.view, hand.strengths);
        const view = await getCore().applyAction(hand.config, hand.seed, hand.view.events, action);
        if (!cancelled) update({ ...hand, view });
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }, BOT_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hand, profiles]);

  const view = hand?.view;
  const legal = view?.legal;
  const heroToAct = legal?.seat === HERO;

  return (
    <section className="panel" aria-labelledby="hand-heading">
      <h2 id="hand-heading">Play a hand</h2>
      <p className="hint">You're seat 0 against five bots. The math panel appears on your turn.</p>
      <div className="toolbar">
        <button onClick={deal} disabled={!profiles}>
          {hand ? "Deal next hand" : "Deal a hand"}
        </button>
        <label>
          <input type="checkbox" checked={showBotCards} onChange={(e) => setShowBotCards(e.target.checked)} /> Show bot cards
        </label>
        <label>
          <input type="checkbox" checked={revealProfiles} onChange={(e) => setRevealProfiles(e.target.checked)} /> Tell the math
          panel each bot's style
        </label>
      </div>

      {view && hand && (
        <>
          <div className="table">
            {view.players.map((p, seat) => {
              const faceUp = seat === HERO || showBotCards || (view.complete && !p.folded);
              return (
                <div key={seat} className={`seat${view.toAct === seat ? " acting" : ""}${p.folded ? " folded" : ""}`}>
                  <div className="seat-name">
                    {seat === HERO ? "You" : `Seat ${seat}`}
                    {hand.config.button === seat && <span className="button-chip" title="Dealer button">D</span>}
                  </div>
                  {seat !== HERO && (
                    <div className="style">{revealProfiles || view.complete ? PROFILES[profileOf(seat)].name : "style hidden"}</div>
                  )}
                  <div className="hole">
                    {p.hole?.map((c) => (faceUp ? <CardFace key={c} card={c} /> : <span key={c} className="card back" aria-label="hidden card" />))}
                  </div>
                  <div>Stack {p.stack}</div>
                  <div>Bet {p.streetBet}</div>
                  <div className="badges">
                    {p.folded && <span>folded</span>}
                    {p.allIn && <span>all-in</span>}
                    {view.toAct === seat && <span className="to-act">{seat === HERO ? "your turn" : "thinking…"}</span>}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="middle">
            <div className="board">
              {view.board.length ? view.board.map((c) => <CardFace key={c} card={c} />) : <span className="hint">no board yet</span>}
            </div>
            <div>
              {view.street} · pot {view.pot}
              {view.complete && " · hand complete"}
            </div>
          </div>

          {legal && heroToAct && (
            <div className="actions" role="group" aria-label="Your actions">
              {legal.toCall > 0 ? (
                <>
                  <button onClick={() => act({ kind: "fold" })}>Fold</button>
                  <button onClick={() => act({ kind: "call" })}>
                    Call {legal.toCall}
                    {legal.callIsAllIn && " (all-in)"}
                  </button>
                </>
              ) : (
                <button onClick={() => act({ kind: "check" })}>Check</button>
              )}
              {legal.minRaiseTo !== null && (
                <>
                  <input
                    type="number"
                    aria-label={legal.isBet ? "Bet amount" : "Raise to"}
                    min={legal.minRaiseTo}
                    max={legal.maxRaiseTo}
                    value={raiseTo}
                    onChange={(e) => setRaiseTo(Number(e.target.value))}
                  />
                  <button onClick={() => act(legal.isBet ? { kind: "bet", amount: raiseTo } : { kind: "raise", to: raiseTo })}>
                    {legal.isBet ? "Bet" : "Raise to"} {raiseTo}
                  </button>
                  <button onClick={() => act({ kind: "allIn" })}>All-in ({legal.maxRaiseTo})</button>
                </>
              )}
            </div>
          )}

          {error && <p className="error">{error}</p>}

          {heroToAct && profiles && (
            <AnalysisPanel
              config={hand.config}
              seed={hand.seed}
              view={view}
              hero={HERO}
              modelFor={modelFor}
              modelLabel={modelLabel}
              strengths={hand.strengths}
            />
          )}

          <details className="log">
            <summary>Event log ({view.events.length} events) · seed {hand.seed}</summary>
            <ol>
              {describeEvents(view.events).map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ol>
          </details>
        </>
      )}
    </section>
  );
}

function CardFace({ card }: { card: Card }) {
  return <span className={`card${isRed(card) ? " red" : ""}`}>{cardToSymbol(card)}</span>;
}

function describeEvents(events: HandEvent[]): string[] {
  const streets = ["Flop", "Turn", "River"];
  let boards = 0;
  const who = (seat: number) => (seat === HERO ? "You" : `Seat ${seat}`);
  return events.map((e) => {
    switch (e.t) {
      case "blind":
        return `${who(e.seat)} post${e.seat === HERO ? "" : "s"} ${e.amount}`;
      case "deal":
        return e.seat === HERO ? `You are dealt ${e.cards.map(cardToSymbol).join(" ")}` : `${who(e.seat)} is dealt two cards`;
      case "board":
        return `${streets[boards++]}: ${e.cards.map(cardToSymbol).join(" ")}`;
      case "award":
        return `${who(e.seat)} win${e.seat === HERO ? "" : "s"} ${e.amount} from the ${e.potIndex === 0 ? "main pot" : `side pot ${e.potIndex}`}`;
      case "act": {
        const a = e.action;
        const what =
          a.kind === "bet" ? `bet ${a.amount}` : a.kind === "raise" ? `raise to ${a.to}` : a.kind === "allIn" ? "go all-in" : a.kind;
        return e.seat === HERO ? `You ${what}` : `${who(e.seat)} ${what.replace(/^(\w+)/, (v) => (v === "go" ? "goes" : `${v}s`))}`;
      }
    }
  });
}
