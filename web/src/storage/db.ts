// Saved hands, in the browser's IndexedDB (via Dexie). Nothing leaves the
// device; accounts and sync come later, with a backend.

import Dexie, { type EntityTable } from "dexie";
import type { DecisionLabel, HandHistory, MistakeCategory, Street } from "../core/types";
import type { CoachMode } from "../state/store";
import type { SessionSettings } from "../state/session";

export type SessionRow = {
  id: string;
  startedAt: number;
  settings: SessionSettings;
  coachMode: CoachMode;
  revealStyles: boolean;
};

/**
 * One row per graded decision, kept apart from the hand so the stats screen
 * can add up mistakes without reading every hand's full history.
 */
export type DecisionRow = {
  id?: number;
  handId: string;
  sessionId: string;
  playedAt: number;
  street: Street;
  evLostBb: number;
  label: DecisionLabel;
  category?: MistakeCategory;
};

export class TrainerDb extends Dexie {
  sessions!: EntityTable<SessionRow, "id">;
  hands!: EntityTable<HandHistory, "id">;
  decisions!: EntityTable<DecisionRow, "id">;

  constructor(name = "poker-trainer") {
    super(name);
    this.version(1).stores({
      sessions: "id, startedAt",
      hands: "id, sessionId, playedAt",
      decisions: "++id, handId, sessionId, playedAt, label, category",
    });
  }
}
