import { useEffect } from "react";
import { CoreLab } from "./dev/CoreLab";
import { useGame } from "./state/useGame";
import { AppNav } from "./ui/AppNav";
import { PlayView } from "./ui/PlayView";
import { ReviewScreen } from "./ui/review/ReviewScreen";
import { StatsScreen } from "./ui/stats/StatsScreen";
import { TableSetup } from "./ui/TableSetup";
import "./ui/app.css";

/** Screens: table setup → play, plus review and stats. `?lab` opens the developer page. */
export default function App() {
  const screen = useGame((s) => s.screen);
  const load = useGame((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  if (new URLSearchParams(window.location.search).has("lab")) return <CoreLab />;
  return (
    <>
      <AppNav />
      {screen === "setup" && <TableSetup />}
      {screen === "play" && <PlayView />}
      {screen === "review" && <ReviewScreen />}
      {screen === "stats" && <StatsScreen />}
    </>
  );
}
