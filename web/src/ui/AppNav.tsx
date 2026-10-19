import { useGame } from "../state/useGame";
import type { Screen } from "../state/store";

const ITEMS: [Screen, string][] = [
  ["play", "Play"],
  ["review", "Review"],
  ["stats", "Stats"],
];

export function AppNav() {
  const screen = useGame((s) => s.screen);
  const goTo = useGame((s) => s.goTo);
  const storageError = useGame((s) => s.storageError);
  const current = screen === "setup" ? "play" : screen;
  return (
    <>
      <nav className="app-nav" aria-label="Main">
        <span className="brand">Poker Trainer</span>
        {ITEMS.map(([target, label]) => (
          <button key={target} type="button" aria-current={current === target ? "page" : undefined} className={current === target ? "on" : ""} onClick={() => goTo(target)}>
            {label}
          </button>
        ))}
      </nav>
      {storageError && (
        <p className="storage-warning" role="alert">
          {storageError}
        </p>
      )}
    </>
  );
}
