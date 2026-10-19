import { useEffect, useState } from "react";
import { positionOf } from "../../bots/positions";
import type { HandHistory } from "../../core/types";
import { useGame } from "../../state/useGame";
import { CardView } from "../CardView";
import { LabelBadge } from "./LabelBadge";
import { HandDetail } from "./HandDetail";

/** Screen 3: saved hands, newest first; open one for a street-by-street review. */
export function ReviewScreen() {
  const repo = useGame((s) => s.repo);
  const savedHands = useGame((s) => s.savedHands);
  const [hands, setHands] = useState<HandHistory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<HandHistory | null>(null);

  useEffect(() => {
    if (!repo) return;
    repo.listHands().then(setHands, (e: Error) => setError(e.message));
  }, [repo, savedHands]);

  if (open) return <HandDetail hand={open} onBack={() => setOpen(null)} />;

  return (
    <main className="review">
      <h1>Hand review</h1>
      <p className="muted">
        Every hand you finish is saved on this device. Open one to replay it street by street and see how each of your
        decisions graded.
      </p>
      {!repo && <p className="error">Saving isn't available in this browser, so there are no hands to review.</p>}
      {error && <p className="error">{error}</p>}
      {hands && hands.length === 0 && <p>No hands yet. Play a few and they'll appear here.</p>}
      {hands && hands.length > 0 && (
        <table className="hand-list">
          <thead>
            <tr>
              <th scope="col">Hand</th>
              <th scope="col">Played</th>
              <th scope="col">Position</th>
              <th scope="col">Your cards</th>
              <th scope="col">Board</th>
              <th scope="col">Result</th>
              <th scope="col">Decisions</th>
              <th scope="col">
                <span className="visually-hidden">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {hands.map((h) => (
              <HandRow key={h.id} hand={h} onOpen={() => setOpen(h)} />
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

function HandRow({ hand, onOpen }: { hand: HandHistory; onOpen: () => void }) {
  const deal = hand.events.find((e) => e.t === "deal" && e.seat === hand.heroSeat);
  const board = hand.events.flatMap((e) => (e.t === "board" ? e.cards : []));
  const counts = { fine: 0, marginal: 0, mistake: 0 };
  for (const d of hand.analyses) counts[d.label]++;
  const net = hand.netBb;
  return (
    <tr>
      <td>#{hand.number}</td>
      <td>{new Date(hand.playedAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}</td>
      <td>{positionOf(hand.heroSeat, hand.config)}</td>
      <td className="cards">{deal?.t === "deal" && deal.cards.map((c) => <CardView key={c} card={c} size="sm" />)}</td>
      <td className="cards">{board.length ? board.map((c) => <CardView key={c} card={c} size="sm" />) : <span className="muted">—</span>}</td>
      <td className={net > 0 ? "up" : net < 0 ? "down" : ""}>
        {net > 0 ? "+" : net < 0 ? "−" : ""}
        {Math.abs(net).toFixed(1)} BB
      </td>
      <td className="label-counts">
        {hand.analyses.length === 0 && <span className="muted">none</span>}
        {(["mistake", "marginal", "fine"] as const).map((l) => (counts[l] ? <LabelBadge key={l} label={l} count={counts[l]} /> : null))}
      </td>
      <td>
        <button type="button" onClick={onOpen}>
          Review
        </button>
      </td>
    </tr>
  );
}
