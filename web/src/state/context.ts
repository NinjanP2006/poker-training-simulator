import { createContext } from "react";
import type { GameStore } from "./store";

export const StoreContext = createContext<GameStore | null>(null);
