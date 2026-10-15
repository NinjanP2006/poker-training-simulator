import { useState } from "react";
import { cardToSymbol, isRed } from "../core/cards";
import type { Action, Card, HandEvent, HandView, TableConfig } from "../core/types";
import { getCore } from "../worker/core";

type Hand = { config: TableConfig; seed: string; view: HandView };

const SEATS = 3;
const STACK = 200;

/** A random 64-bit seed as a decimal string (JavaScript numbers can't hold all u64 values). */
function randomSeed(): string {
  const [hi, lo] = crypto.getRandomValues(new Uint32Array(2));
  return ((BigInt(hi) << 32n) | BigInt(lo)).toString();
}

function tableConfig(button: number): TableConfig {
  return {
    seats: Array.from({ length: SEATS }, () => ({ player: { kind: "hero" as const }, stack: STACK })),
    smallBlind: 1,
    bigBlind: 2,
    button,
  };
}

export function HandDemo() {
  const [hand, setHand] = useState<Hand | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [raiseTo, setRaiseTo] = useState(0);

  async function deal() {
    const button = hand ? (hand.config.button + 1) % SEATS : 0;
    const config = tableConfig(button);
    const seed = randomSeed();
    try {
      const view = await getCore().newHand(config, seed);
      setHand({ config, seed, view });
      setRaiseTo(view.legal?.minRaiseTo ?? 0);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function act(action: Action) {
    if (!hand) return;
    try {
      const view = await getCore().applyAction(hand.config, hand.seed, hand.view.events, action);
      setHand({ ...hand, view });
      setRaiseTo(view.legal?.minRaiseTo ?? 0);
      setError(null);
    } catch (e) {
      setError((e as Error).message); // the engine explains why an action is illegal
    }
  }

  const view = hand?.view;
  const legal = view?.legal;

  return (
    <section className="panel" aria-labelledby="hand-heading">
      <h2 id="hand-heading">Play a hand</h2>
      <p className="hint">You act for every seat. All cards are face up; this is for checking the engine.</p>
      <button onClick={deal}>{hand ? "Deal next hand" : "Deal a hand"}</button>

      {view && hand && (
        <>
          <div className="table">
            {view.players.map((p, seat) => (
              <div key={seat} className={`seat${view.toAct === seat ? " acting" : ""}${p.folded ? " folded" : ""}`}>
                <div className="seat-name">
                  Seat {seat}
                  {hand.config.button === seat && <span className="button-chip" title="Dealer button">D</span>}
                </div>
                <div className="hole">{p.hole?.map((c) => <CardFace key={c} card={c} />)}</div>
                <div>Stack {p.stack}</div>
                <div>Bet {p.streetBet}</div>
                <div className="badges">
                  {p.folded && <span>folded</span>}
                  {p.allIn && <span>all-in</span>}
                  {view.toAct === seat && <span className="to-act">to act</span>}
                </div>
              </div>
            ))}
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

          {legal && (
            <div className="actions" role="group" aria-label={`Actions for seat ${legal.seat}`}>
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
                  <button
                    onClick={() => act(legal.isBet ? { kind: "bet", amount: raiseTo } : { kind: "raise", to: raiseTo })}
                  >
                    {legal.isBet ? "Bet" : "Raise to"} {raiseTo}
                  </button>
                  <button onClick={() => act({ kind: "allIn" })}>All-in ({legal.maxRaiseTo})</button>
                </>
              )}
              {legal.minRaiseTo === null && legal.callIsAllIn === false && legal.toCall > 0 && (
                <span className="hint">Raising isn't allowed here.</span>
              )}
            </div>
          )}

          {error && <p className="error">{error}</p>}

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
  return events.map((e) => {
    switch (e.t) {
      case "blind":
        return `Seat ${e.seat} posts ${e.amount}`;
      case "deal":
        return `Seat ${e.seat} is dealt ${e.cards.map(cardToSymbol).join(" ")}`;
      case "board":
        return `${streets[boards++]}: ${e.cards.map(cardToSymbol).join(" ")}`;
      case "award":
        return `Seat ${e.seat} wins ${e.amount} from the ${e.potIndex === 0 ? "main pot" : `side pot ${e.potIndex}`}`;
      case "act": {
        const a = e.action;
        const what =
          a.kind === "bet" ? `bets ${a.amount}` : a.kind === "raise" ? `raises to ${a.to}` : a.kind === "allIn" ? "goes all-in" : `${a.kind}s`;
        return `Seat ${e.seat} ${what}`;
      }
    }
  });
}
