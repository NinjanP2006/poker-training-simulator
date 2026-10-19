import { useEffect, useState } from "react";
import "../App.css";
import { coreStartup, type StartupInfo } from "../worker/core";
import { EquityLab } from "./EquityLab";

/** Native release-build throughput from the Criterion benchmark (Phase 1, dev machine). */
const NATIVE_EVALS_PER_SEC = 44.7e6;

/** Developer page (open with ?lab): core speed and a free-form equity calculator. */
export function CoreLab() {
  const [info, setInfo] = useState<StartupInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    coreStartup().then(setInfo, (e: Error) => setError(e.message));
  }, []);

  const millions = (n: number) => `${(n / 1e6).toFixed(1)}M`;
  return (
    <main className="lab">
      <header>
        <h1>
          Poker Trainer <span className="tag">core lab</span>
        </h1>
        <p className="subtitle">
          Developer page: the Rust engine running as WebAssembly in a Web Worker. <a href="./">Back to the trainer</a>
        </p>
        {error && <p className="status error">Core failed to start: {error}</p>}
        {!info && !error && <p className="status">Starting the core…</p>}
        {info && (
          <p className="status ok">
            Core ready · lookup tables built in {info.tableMs.toFixed(0)} ms · {millions(info.evalsPerSec)} evaluations/s in WebAssembly (
            {(NATIVE_EVALS_PER_SEC / info.evalsPerSec).toFixed(2)}× native; target ≤ 2×) · first run {millions(info.firstRunEvalsPerSec)}/s
          </p>
        )}
      </header>
      <EquityLab />
    </main>
  );
}
