import { useEffect, useState } from "react";
import { CATEGORIES, CATEGORY_NAMES, computeStats } from "../../review/stats";
import type { DecisionRow, SessionRow } from "../../storage/db";
import { useGame } from "../../state/useGame";
import { LabelBadge } from "../review/LabelBadge";
import { CategoryBars } from "./CategoryBars";
import { TrendChart } from "./TrendChart";

type Data = { decisions: DecisionRow[]; sessions: SessionRow[]; counts: Map<string, number> };

/** Screen 4: session and lifetime stats. */
export function StatsScreen() {
  const repo = useGame((s) => s.repo);
  const savedHands = useGame((s) => s.savedHands);
  const currentSession = useGame((s) => s.sessionId);
  const [data, setData] = useState<Data | null>(null);
  const [scope, setScope] = useState<"session" | "all">("all");
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!repo) return;
    Promise.all([repo.listDecisions(), repo.listSessions(), repo.handCounts()]).then(
      ([decisions, sessions, counts]) => setData({ decisions, sessions, counts }),
      (e: Error) => setError(e.message),
    );
  }, [repo, savedHands]);

  if (!repo) return <main className="stats"><h1>Stats</h1><p className="error">Saving isn't available in this browser, so there are no stats.</p></main>;
  if (!data) return <main className="stats"><h1>Stats</h1>{error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}</main>;

  // "This session": the table in progress, or the most recent one played.
  const played = data.sessions.filter((s) => (data.counts.get(s.id) ?? 0) > 0);
  const sessionId = currentSession && data.counts.get(currentSession) ? currentSession : played.at(-1)?.id;
  const stats = computeStats(data.decisions, data.sessions, data.counts, scope === "session" ? sessionId : undefined);

  const clearAll = async () => {
    await repo.clearAll();
    setConfirmClear(false);
    setData({ decisions: [], sessions: [], counts: new Map() });
  };

  return (
    <main className="stats">
      <h1>Stats</h1>
      <div className="filter-row">
        <div className="segmented" role="radiogroup" aria-label="Which hands">
          {(
            [
              ["session", "This session"],
              ["all", "All time"],
            ] as const
          ).map(([value, label]) => (
            <button key={value} type="button" role="radio" aria-checked={scope === value} className={scope === value ? "on" : ""} onClick={() => setScope(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {stats.hands === 0 ? (
        <p>No hands played {scope === "session" ? "in this session" : "yet"}. Finish a few hands and your stats appear here.</p>
      ) : (
        <>
          <div className="tiles">
            <div className="tile">
              <div className="tile-label">Hands played</div>
              <div className="tile-value">{stats.hands.toLocaleString()}</div>
            </div>
            <div className="tile">
              <div className="tile-label">Mistakes per 100 hands</div>
              <div className="tile-value">{stats.mistakesPer100.toFixed(1)}</div>
            </div>
            <div className="tile">
              <div className="tile-label">EV lost per 100 hands</div>
              <div className="tile-value">{stats.evLostPer100.toFixed(1)} BB</div>
            </div>
            <div className="tile">
              <div className="tile-label">Decisions graded</div>
              <div className="tile-value">{stats.decisions.toLocaleString()}</div>
              <div className="tile-badges">
                <LabelBadge label="fine" count={stats.labels.fine} />
                <LabelBadge label="marginal" count={stats.labels.marginal} />
                <LabelBadge label="mistake" count={stats.labels.mistake} />
              </div>
            </div>
          </div>

          <CategoryBars
            title="EV lost by kind of error"
            unit="BB"
            data={CATEGORIES.map((c) => ({
              label: CATEGORY_NAMES[c],
              value: stats.byCategory[c].evLostBb,
              detail: `${stats.byCategory[c].count} decision${stats.byCategory[c].count === 1 ? "" : "s"}`,
            }))}
          />

          {scope === "all" &&
            (stats.sessions.length >= 2 ? (
              <TrendChart
                title="Mistakes per 100 hands, by session"
                unit="mistakes / 100 hands"
                points={stats.sessions.map((s, i) => ({
                  label: `Session ${i + 1}`,
                  value: s.mistakesPer100,
                  detail: `${s.hands} hands, ${new Date(s.startedAt).toLocaleDateString()}`,
                }))}
              />
            ) : (
              <p className="muted">Play a second session to see whether your mistakes per 100 hands are falling.</p>
            ))}
          <p className="note">EV lost is estimated: each decision is compared with the best option by the trainer's one-street model.</p>
        </>
      )}

      <div className="danger-zone">
        {confirmClear ? (
          <>
            <span>Delete every saved hand and stat on this device?</span>
            <button type="button" className="danger" onClick={() => void clearAll()}>
              Yes, delete everything
            </button>
            <button type="button" onClick={() => setConfirmClear(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="link" onClick={() => setConfirmClear(true)}>
            Delete saved hands…
          </button>
        )}
      </div>
    </main>
  );
}
