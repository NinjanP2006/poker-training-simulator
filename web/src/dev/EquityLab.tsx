import { useEffect, useRef, useState } from "react";
import { parseCards } from "../core/cards";
import type { Card, EquityResult } from "../core/types";
import { getCore } from "../worker/core";

type Outcome =
  | { kind: "idle" }
  | { kind: "result"; result: EquityResult; latencyMs: number }
  | { kind: "error"; message: string };

type LatencyReport = { spots: number; p50: number; p95: number; max: number; exact: number; sampled: number };

const percent = (x: number) => `${(x * 100).toFixed(1)}%`;

export function EquityLab() {
  const [hero, setHero] = useState("As Kd");
  const [board, setBoard] = useState("Ts 9h 2c");
  const [dead, setDead] = useState("");
  const [range, setRange] = useState("22+, A2s+, KTo+, QJs");
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const [report, setReport] = useState<LatencyReport | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const latest = useRef(0);

  // Recompute shortly after the user stops typing. Responses that arrive
  // after a newer request was sent are ignored.
  useEffect(() => {
    const request = ++latest.current;
    const timer = setTimeout(async () => {
      try {
        const heroCards = parseCards(hero);
        if (heroCards.length !== 2) throw new Error("Your hand needs exactly 2 cards.");
        const core = getCore();
        const villain = await core.parseRange(range);
        const start = performance.now();
        const result = await core.equity({
          hero: heroCards as [Card, Card],
          villain,
          board: parseCards(board),
          dead: parseCards(dead),
        });
        if (request === latest.current) {
          setOutcome({ kind: "result", result, latencyMs: performance.now() - start });
        }
      } catch (e) {
        if (request === latest.current) setOutcome({ kind: "error", message: (e as Error).message });
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [hero, board, dead, range]);

  async function measureLatency() {
    setMeasuring(true);
    try {
      setReport(await randomFlopLatency(range, 100));
    } catch (e) {
      setOutcome({ kind: "error", message: (e as Error).message });
    } finally {
      setMeasuring(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="equity-heading">
      <h2 id="equity-heading">Equity</h2>
      <div className="fields">
        <label>
          Your hand
          <input value={hero} onChange={(e) => setHero(e.target.value)} placeholder="As Kd" />
        </label>
        <label>
          Board
          <input value={board} onChange={(e) => setBoard(e.target.value)} placeholder="Ts 9h 2c (or empty)" />
        </label>
        <label>
          Dead cards
          <input value={dead} onChange={(e) => setDead(e.target.value)} placeholder="optional" />
        </label>
        <label className="wide">
          Opponent range
          <input value={range} onChange={(e) => setRange(e.target.value)} placeholder="22+, A2s+, KTo+, QJs" />
        </label>
      </div>

      <div aria-live="polite">
        {outcome.kind === "error" && <p className="error">{outcome.message}</p>}
        {outcome.kind === "result" && <EquityReadout {...outcome} />}
      </div>

      <div className="latency">
        <button onClick={measureLatency} disabled={measuring}>
          {measuring ? "Measuring…" : "Measure latency on 100 random flops"}
        </button>
        {report && (
          <p>
            {report.spots} spots against this range: p50 {report.p50.toFixed(1)} ms · <strong>p95 {report.p95.toFixed(1)} ms</strong> ·
            max {report.max.toFixed(1)} ms (target p95 &lt; 100 ms) · {report.exact} exact, {report.sampled} sampled
          </p>
        )}
      </div>
    </section>
  );
}

function EquityReadout({ result, latencyMs }: { result: EquityResult; latencyMs: number }) {
  return (
    <div className="readout">
      <div className="big">
        {percent(result.equity)}
        {result.stdErr !== null && <span className="pm"> ± {percent(1.96 * result.stdErr)}</span>}
      </div>
      <dl>
        <dt>Win / tie</dt>
        <dd>
          {percent(result.win)} / {percent(result.tie)}
        </dd>
        <dt>Method</dt>
        <dd>{result.method === "exact" ? "exact enumeration" : "Monte Carlo (95% interval)"}</dd>
        <dt>Opponent combos</dt>
        <dd>{result.liveCombos} after blockers</dd>
        <dt>Evaluations</dt>
        <dd>{result.evaluations.toLocaleString()}</dd>
        <dt>Round trip</dt>
        <dd>{latencyMs.toFixed(1)} ms</dd>
      </dl>
    </div>
  );
}

/** Times equity requests for random hero hands on random flops. */
async function randomFlopLatency(notation: string, count: number): Promise<LatencyReport> {
  const core = getCore();
  const villain = await core.parseRange(notation);
  const times: number[] = [];
  let exact = 0;
  for (let i = 0; i < count; i++) {
    const deck = Array.from({ length: 52 }, (_, c) => c);
    const pick = () => deck.splice(Math.floor(Math.random() * deck.length), 1)[0];
    const hero: [Card, Card] = [pick(), pick()];
    const board = [pick(), pick(), pick()];
    const start = performance.now();
    try {
      const r = await core.equity({ hero, villain, board, options: { seed: i } });
      times.push(performance.now() - start);
      if (r.method === "exact") exact++;
    } catch {
      // Every opponent combo blocked by these cards; skip the spot.
    }
  }
  times.sort((a, b) => a - b);
  const at = (q: number) => times[Math.min(times.length - 1, Math.floor(q * times.length))];
  return { spots: times.length, p50: at(0.5), p95: at(0.95), max: times[times.length - 1], exact, sampled: times.length - exact };
}
