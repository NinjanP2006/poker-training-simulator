import { useEffect, useState } from "react";
import type { Action, LegalActions } from "../core/types";
import { bb } from "../explain/format";

type Props = {
  legal: LegalActions;
  pot: number;
  currentBet: number;
  bigBlind: number;
  disabled?: boolean;
  onAct: (action: Action) => void;
};

/** Bet/raise sizes as fractions of the pot after calling (the same sizes the analysis uses). */
const SIZE_PRESETS: [string, number][] = [
  ["⅓ pot", 1 / 3],
  ["½ pot", 1 / 2],
  ["¾ pot", 3 / 4],
  ["Pot", 1],
];

function presetTotal(fraction: number, legal: LegalActions, pot: number, currentBet: number): number {
  const target = Math.round(currentBet + fraction * (pot + legal.toCall));
  return Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo ?? 0, target));
}

/**
 * Fold / check / call / bet-or-raise with a size slider and presets.
 * Keyboard: F fold, C check or call, R (or B) bet/raise the chosen size, A all-in.
 *
 * Give it a new `key` for each decision so the size starts fresh at half pot.
 */
export function ActionBar({ legal, pot, currentBet, bigBlind, disabled = false, onAct }: Props) {
  const canRaise = legal.minRaiseTo !== null;
  const [size, setSize] = useState(() => (canRaise ? presetTotal(1 / 2, legal, pot, currentBet) : 0));

  const raiseAction = (to: number): Action => {
    if (to >= legal.maxRaiseTo) return { kind: "allIn" };
    return legal.isBet ? { kind: "bet", amount: to } : { kind: "raise", to };
  };

  const passive: Action = legal.toCall > 0 ? { kind: "call" } : { kind: "check" };

  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" && (target as HTMLInputElement).type !== "range")) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "f" && legal.toCall > 0) onAct({ kind: "fold" });
      else if (key === "c" || key === "k") onAct(passive);
      else if ((key === "r" || key === "b") && canRaise) onAct(raiseAction(size));
      else if (key === "a" && (canRaise || legal.callIsAllIn)) onAct({ kind: "allIn" });
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const verb = legal.isBet ? "Bet" : "Raise to";

  return (
    <div className="action-bar" role="group" aria-label="Your actions">
      <div className="main-actions">
        {legal.toCall > 0 && (
          <button type="button" className="act fold" disabled={disabled} onClick={() => onAct({ kind: "fold" })}>
            Fold <kbd>F</kbd>
          </button>
        )}
        <button type="button" className="act passive" disabled={disabled} onClick={() => onAct(passive)}>
          {legal.toCall > 0 ? `Call ${bb(legal.toCall, bigBlind)}${legal.callIsAllIn ? " (all-in)" : ""}` : "Check"} <kbd>C</kbd>
        </button>
        {canRaise && (
          <button type="button" className="act aggressive" disabled={disabled} onClick={() => onAct(raiseAction(size))}>
            {size >= legal.maxRaiseTo ? "All-in" : `${verb} ${bb(size, bigBlind)}`} <kbd>R</kbd>
          </button>
        )}
      </div>
      {canRaise && (
        <div className="sizing">
          <input
            type="range"
            aria-label={legal.isBet ? "Bet size" : "Raise to"}
            min={legal.minRaiseTo!}
            max={legal.maxRaiseTo}
            step={1}
            value={size}
            disabled={disabled}
            onChange={(e) => setSize(Number(e.target.value))}
          />
          <div className="presets">
            <button type="button" disabled={disabled} onClick={() => setSize(legal.minRaiseTo!)}>
              Min
            </button>
            {SIZE_PRESETS.map(([label, f]) => (
              <button key={label} type="button" disabled={disabled} onClick={() => setSize(presetTotal(f, legal, pot, currentBet))}>
                {label}
              </button>
            ))}
            <button type="button" disabled={disabled} onClick={() => setSize(legal.maxRaiseTo)}>
              All-in <kbd>A</kbd>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
