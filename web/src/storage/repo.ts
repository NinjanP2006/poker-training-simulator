// Reading and writing saved play. The store and screens use this interface,
// so tests can swap in a database backed by fake-indexeddb.

import type { HandHistory } from "../core/types";
import type { SessionSettings } from "../state/session";
import type { CoachMode } from "../state/store";
import { type DecisionRow, type SessionRow, TrainerDb } from "./db";

export type HandRepository = {
  startSession(settings: SessionSettings, coachMode: CoachMode, revealStyles: boolean): Promise<string>;
  saveHand(hand: HandHistory): Promise<void>;
  getHand(id: string): Promise<HandHistory | undefined>;
  /** Most recent first. */
  listHands(limit?: number): Promise<HandHistory[]>;
  listSessions(): Promise<SessionRow[]>;
  listDecisions(): Promise<DecisionRow[]>;
  /** Hands per session, for the stats screen. */
  handCounts(): Promise<Map<string, number>>;
  clearAll(): Promise<void>;
};

export function createRepository(db: TrainerDb = new TrainerDb()): HandRepository {
  return {
    async startSession(settings, coachMode, revealStyles) {
      const id = crypto.randomUUID();
      await db.sessions.add({ id, startedAt: Date.now(), settings, coachMode, revealStyles });
      return id;
    },

    async saveHand(hand) {
      // The hand and its decision rows are written together, or not at all.
      await db.transaction("rw", db.hands, db.decisions, async () => {
        await db.hands.put(hand);
        await db.decisions.where("handId").equals(hand.id).delete();
        await db.decisions.bulkAdd(
          hand.analyses.map((d) => ({
            handId: hand.id,
            sessionId: hand.sessionId,
            playedAt: hand.playedAt,
            street: d.street,
            evLostBb: d.evLost,
            label: d.label,
            category: d.category,
          })),
        );
      });
    },

    getHand: (id) => db.hands.get(id),

    listHands: (limit = 200) => db.hands.orderBy("playedAt").reverse().limit(limit).toArray(),

    listSessions: () => db.sessions.orderBy("startedAt").toArray(),

    listDecisions: () => db.decisions.toArray(),

    async handCounts() {
      const counts = new Map<string, number>();
      await db.hands.each((h) => counts.set(h.sessionId, (counts.get(h.sessionId) ?? 0) + 1));
      return counts;
    },

    async clearAll() {
      await db.transaction("rw", db.sessions, db.hands, db.decisions, async () => {
        await Promise.all([db.sessions.clear(), db.hands.clear(), db.decisions.clear()]);
      });
    },
  };
}
