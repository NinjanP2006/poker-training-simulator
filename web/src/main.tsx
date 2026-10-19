import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { GameProvider } from "./state/GameContext";
import { createGameStore } from "./state/store";
import { getCore } from "./worker/core";

const store = createGameStore({ core: getCore() });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GameProvider store={store}>
      <App />
    </GameProvider>
  </StrictMode>,
);
