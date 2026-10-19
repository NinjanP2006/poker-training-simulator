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

  // On a screen change, move focus to the new screen's heading so keyboard and
  // screen-reader users start at the new content (not on the button they pressed).
  useEffect(() => {
    const heading = document.querySelector<HTMLElement>("main h1");
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }, [screen]);

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
