import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { GameProvider } from "./state/GameContext";
import { createGameStore } from "./state/store";
import { createRepository, type HandRepository } from "./storage/repo";
import { getCore } from "./worker/core";

// Saved hands live in IndexedDB. If the browser blocks it (some private
// modes), the trainer still works; it just doesn't save.
let repo: HandRepository | null = null;
try {
  repo = typeof indexedDB === "undefined" ? null : createRepository();
} catch {
  repo = null;
}

const store = createGameStore({ core: getCore(), repo });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GameProvider store={store}>
      <App />
    </GameProvider>
  </StrictMode>,
);
