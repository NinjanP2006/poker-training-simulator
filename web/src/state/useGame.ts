import { useContext } from "react";
import { useStore } from "zustand";
import { StoreContext } from "./context";
import type { GameState } from "./store";

/** Reads from the game store; re-renders only when the selected value changes. */
export function useGame<T>(selector: (state: GameState) => T): T {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useGame must be used inside <GameProvider>");
  return useStore(store, selector);
}
