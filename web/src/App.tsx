import { useEffect, useState } from "react";
import "./App.css";
import { EquityLab } from "./dev/EquityLab";
import { HandDemo } from "./dev/HandDemo";
import { coreStartup, type StartupInfo } from "./worker/core";

/** Native release-build throughput from the Criterion benchmark (Phase 1, dev machine). */
const NATIVE_EVALS_PER_SEC = 44.7e6;

type Status =
  | { state: "loading" }
  | { state: "ready"; info: StartupInfo }
  | { state: "error"; message: string };

export default function App() {
  const [status, setStatus] = useState<Status>({ state: "loading" });

  useEffect(() => {
    coreStartup().then(
      (info) => setStatus({ state: "ready", info }),
      (e: Error) => setStatus({ state: "error", message: e.message }),
    );
  }, []);

  return (
    <main className="lab">
      <header>
        <h1>
          Poker Trainer <span className="tag">core lab</span>
        </h1>
        <p className="subtitle">
          Development page: the Rust engine running as WebAssembly in a Web Worker. The real table arrives in Phase 7.
        </p>
        <StatusLine status={status} />
      </header>
      <EquityLab />
      <HandDemo />
    </main>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (status.state === "loading") return <p className="status">Starting the core…</p>;
  if (status.state === "error") return <p className="status error">Core failed to start: {status.message}</p>;
  const { tableMs, evalsPerSec, firstRunEvalsPerSec } = status.info;
  const millions = (n: number) => `${(n / 1e6).toFixed(1)}M`;
  return (
    <p className="status ok">
      Core ready · lookup tables built in {tableMs.toFixed(0)} ms · {millions(evalsPerSec)} evaluations/s in WebAssembly (
      {(NATIVE_EVALS_PER_SEC / evalsPerSec).toFixed(2)}× native; target ≤ 2×) · first run before browser optimization{" "}
      {millions(firstRunEvalsPerSec)}/s
    </p>
  );
}
