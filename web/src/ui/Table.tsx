import { positionOf } from "../bots/positions";
import { PROFILES } from "../bots/profiles";
import type { Action, HandEvent, HandView, TableConfig } from "../core/types";
import { bb } from "../explain/format";
import { CardBack, CardView } from "./CardView";

type Props = {
  config: TableConfig;
  view: HandView;
  hero: number;
  /** Show bot styles on their seats. */
  revealStyles: boolean;
  /** Show every player's cards (hand review). */
  revealAll?: boolean;
};

/** Seat positions around the oval, with the player at the bottom and play going clockwise. */
function seatPosition(seat: number, hero: number, n: number, radiusX: number, radiusY: number) {
  const r = (seat - hero + n) % n;
  const angle = Math.PI / 2 + (r * 2 * Math.PI) / n;
  return { left: `${50 + radiusX * Math.cos(angle)}%`, top: `${50 + radiusY * Math.sin(angle)}%` };
}

/** Each seat's most recent action on the current street. */
function streetActions(events: HandEvent[]): Map<number, Action> {
  const last = new Map<number, Action>();
  for (const e of events) {
    if (e.t === "board") last.clear();
    if (e.t === "act") last.set(e.seat, e.action);
  }
  return last;
}

function actionWord(a: Action, bigBlind: number): string {
  switch (a.kind) {
    case "bet":
      return `Bet ${bb(a.amount, bigBlind)}`;
    case "raise":
      return `Raise ${bb(a.to, bigBlind)}`;
    case "allIn":
      return "All-in";
    default:
      return a.kind[0].toUpperCase() + a.kind.slice(1);
  }
}

/** Who won what, from the award events. */
function winnings(events: HandEvent[]): Map<number, number> {
  const won = new Map<number, number>();
  for (const e of events) if (e.t === "award") won.set(e.seat, (won.get(e.seat) ?? 0) + e.amount);
  return won;
}

export function Table({ config, view, hero, revealStyles, revealAll = false }: Props) {
  const n = config.seats.length;
  const actions = streetActions(view.events);
  const won = view.complete ? winnings(view.events) : new Map<number, number>();
  const live = view.players.filter((p) => !p.folded).length;
  const showdown = view.complete && live > 1;
  const bigBlind = config.bigBlind;

  return (
    <div className="felt" aria-label="Poker table">
      {view.players.map((p, seat) => {
        const player = config.seats[seat].player;
        const isHero = seat === hero;
        const faceUp = isHero || revealAll || (showdown && !p.folded);
        const style = player.kind === "bot" && (revealStyles || view.complete) ? PROFILES[player.profile].name : null;
        const last = actions.get(seat);
        const winAmount = won.get(seat);
        return (
          <div
            key={seat}
            className={`seat${view.toAct === seat ? " acting" : ""}${p.folded ? " folded" : ""}${isHero ? " hero" : ""}${winAmount ? " winner" : ""}`}
            style={seatPosition(seat, hero, n, 42, 40)}
            aria-label={`${isHero ? "You" : `Bot ${seat}`}, ${positionOf(seat, config)}, stack ${bb(p.stack, bigBlind)}${p.folded ? ", folded" : ""}${view.toAct === seat ? ", to act" : ""}`}
          >
            <div className="seat-cards">
              {p.hole && (faceUp ? p.hole.map((c) => <CardView key={c} card={c} />) : p.hole.map((c) => <CardBack key={c} />))}
            </div>
            <div className="seat-plate">
              <div className="seat-top">
                <span className="seat-name">{isHero ? "You" : `Bot ${seat}`}</span>
                <span className="pos">{positionOf(seat, config)}</span>
                {config.button === seat && <span className="dealer" title="Dealer button">D</span>}
              </div>
              <div className="stack">{bb(p.stack, bigBlind)}</div>
              {style && <div className="style-name">{style}</div>}
              {winAmount ? (
                <div className="seat-status win">Wins {bb(winAmount, bigBlind)}</div>
              ) : p.folded ? (
                <div className="seat-status">Folded</div>
              ) : p.allIn ? (
                <div className="seat-status">All-in</div>
              ) : last ? (
                <div className="seat-status">{actionWord(last, bigBlind)}</div>
              ) : view.toAct === seat ? (
                <div className="seat-status thinking">{isHero ? "Your turn" : "Thinking…"}</div>
              ) : null}
            </div>
          </div>
        );
      })}

      {view.players.map((p, seat) =>
        p.streetBet > 0 && !view.complete ? (
          <div key={`bet-${seat}`} className="bet-chip" style={seatPosition(seat, hero, n, 25, 22)}>
            {bb(p.streetBet, bigBlind)}
          </div>
        ) : null,
      )}

      <div className="center">
        <div className="board" aria-label="Board">
          {view.board.map((c) => (
            <CardView key={c} card={c} size="lg" />
          ))}
          {Array.from({ length: 5 - view.board.length }, (_, i) => (
            <span key={`empty-${i}`} className="pcard lg empty" aria-hidden="true" />
          ))}
        </div>
        <div className="pot">
          {view.complete ? "Hand over" : `Pot ${bb(view.pot, bigBlind)}`}
        </div>
      </div>
    </div>
  );
}
