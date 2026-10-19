import { useEffect } from "react";
import { CoreLab } from "./dev/CoreLab";
import { useGame } from "./state/useGame";
import { PlayView } from "./ui/PlayView";
import { TableSetup } from "./ui/TableSetup";
import "./ui/app.css";

/** Screens: table setup, then the play view. `?lab` opens the developer page. */
export default function App() {
  const screen = useGame((s) => s.screen);
  const load = useGame((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  if (new URLSearchParams(window.location.search).has("lab")) return <CoreLab />;
  return screen === "setup" ? <TableSetup /> : <PlayView />;
}
