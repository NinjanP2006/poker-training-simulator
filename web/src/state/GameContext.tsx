import type { ReactNode } from "react";
import { StoreContext } from "./context";
import type { GameStore } from "./store";

export function GameProvider({ store, children }: { store: GameStore; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}
