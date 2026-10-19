import { useState } from "react";
import { PROFILE_IDS, PROFILES } from "../bots/profiles";
import type { BotProfile } from "../core/types";
import { MAX_STACK_BB, MIN_STACK_BB, PRESETS, resizeLineup, type SessionSettings, type TableSize } from "../state/session";
import { useGame } from "../state/useGame";
import { CoachModeToggle } from "./CoachPanel";

/** Screen 1: choose a preset or build a custom table, then sit down. */
export function TableSetup() {
  const startSession = useGame((s) => s.startSession);
  const revealStyles = useGame((s) => s.revealStyles);
  const setRevealStyles = useGame((s) => s.setRevealStyles);
  const profilesReady = useGame((s) => s.profiles !== null);
  const error = useGame((s) => s.error);
  const [presetId, setPresetId] = useState(PRESETS[0].id);
  const [settings, setSettings] = useState<SessionSettings>(PRESETS[0].settings);

  const choosePreset = (id: string) => {
    setPresetId(id);
    setSettings(PRESETS.find((p) => p.id === id)!.settings);
  };
  const customize = (next: SessionSettings) => {
    setPresetId("custom");
    setSettings(next);
  };

  return (
    <main className="setup">
      <header>
        <h1>Poker Trainer</h1>
        <p className="lead">Play No-Limit Hold'em against bots and see the math behind every decision.</p>
      </header>

      <section aria-labelledby="presets-heading">
        <h2 id="presets-heading">Choose a table</h2>
        <div className="presets-grid" role="radiogroup" aria-label="Presets">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={presetId === p.id}
              className={`preset${presetId === p.id ? " on" : ""}`}
              onClick={() => choosePreset(p.id)}
            >
              <strong>{p.name}</strong>
              <span>{p.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="custom-heading" className="custom">
        <h2 id="custom-heading">{presetId === "custom" ? "Custom table" : "Or adjust it"}</h2>
        <div className="form-row">
          <fieldset>
            <legend>Table size</legend>
            {([2, 6] as TableSize[]).map((size) => (
              <label key={size}>
                <input
                  type="radio"
                  name="table-size"
                  checked={settings.tableSize === size}
                  onChange={() => customize({ ...settings, tableSize: size, lineup: resizeLineup(settings.lineup, size) })}
                />
                {size === 2 ? "Heads-up" : "6-max"}
              </label>
            ))}
          </fieldset>
          <label className="stack-input">
            Stack depth (big blinds)
            <input
              type="number"
              min={MIN_STACK_BB}
              max={MAX_STACK_BB}
              step={5}
              value={settings.stackBb}
              onChange={(e) => {
                const v = Math.round(Number(e.target.value));
                if (Number.isFinite(v)) customize({ ...settings, stackBb: Math.min(MAX_STACK_BB, Math.max(MIN_STACK_BB, v)) });
              }}
            />
          </label>
        </div>
        <fieldset className="lineup">
          <legend>Opponents</legend>
          {settings.lineup.map((profile, i) => (
            <label key={i}>
              Bot {i + 1}
              <select
                value={profile}
                onChange={(e) => {
                  const lineup = [...settings.lineup];
                  lineup[i] = e.target.value as BotProfile;
                  customize({ ...settings, lineup });
                }}
              >
                {PROFILE_IDS.map((id) => (
                  <option key={id} value={id}>
                    {PROFILES[id].name}
                  </option>
                ))}
              </select>
              <span className="muted small">{PROFILES[profile].description}</span>
            </label>
          ))}
        </fieldset>
      </section>

      <section aria-labelledby="coach-heading">
        <h2 id="coach-heading">Coaching</h2>
        <p className="muted">When to show the math panel:</p>
        <CoachModeToggle />
        <label className="check">
          <input type="checkbox" checked={revealStyles} onChange={(e) => setRevealStyles(e.target.checked)} /> Tell the coach each bot's style
          <span className="muted small"> (otherwise it assumes an average opponent, as you would at a real table)</span>
        </label>
      </section>

      {error && <p className="error">{error}</p>}
      <button type="button" className="primary start" disabled={!profilesReady} onClick={() => void startSession(settings)}>
        {profilesReady ? "Sit down" : "Loading…"}
      </button>
    </main>
  );
}
