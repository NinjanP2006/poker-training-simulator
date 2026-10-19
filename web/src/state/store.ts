// The game store (Zustand). Owns the hand in progress, drives the bots,
// computes the math panel's analysis on the player's turn, and grades each
// decision. UI components read it through useGame() (see GameContext.tsx).

import { createStore, type StoreApi } from "zustand/vanilla";
import { decide } from "../bots/bot";
import { foldCurve } from "../bots/foldCurve";
import { type CompiledProfiles, compileProfiles, type Model, populationModel, profileModel, StrengthCache } from "../bots/model";
import { PROFILES } from "../bots/profiles";
import { trackRanges } from "../bots/tracker";
import type { Action, AnalysisOptions, DecisionAnalysis, HandView, Street, TableConfig } from "../core/types";
import { sameAction } from "../explain/format";
import { type Grade, grade } from "../review/grade";
import type { Core } from "../worker/coreClient";
import { HERO, randomSeed, type SessionSettings, tableConfig } from "./session";

export type Screen = "setup" | "play";

/** When the math panel shows: always, only after the player commits to a decision, or never (test mode). */
export type CoachMode = "always" | "afterActing" | "off";

export type HandProgress = {
  /** Increments every hand; async work for an old hand is discarded. */
  id: number;
  number: number;
  config: TableConfig;
  seed: string;
  view: HandView;
  strengths: StrengthCache;
};

/** One graded decision by the player. */
export type DecisionRecord = {
  street: Street;
  analysis: DecisionAnalysis;
  chosen: Action;
  grade: Grade;
  /** Each seat's range the analysis used. */
  ranges: Float32Array[];
};

export type AnalysisState = {
  status: "idle" | "loading" | "ready" | "error";
  /** Event count of the decision this analysis is for. */
  forEvents: number;
  analysis: DecisionAnalysis | null;
  /** Each seat's range used (tracked from actions, or the player's edit). */
  ranges: Float32Array[] | null;
  error: string | null;
};

export type GameState = {
  screen: Screen;
  settings: SessionSettings | null;
  coachMode: CoachMode;
  /** Tell the analysis each bot's style (otherwise it assumes the population average). */
  revealStyles: boolean;
  profiles: CompiledProfiles | null;
  hand: HandProgress | null;
  analysis: AnalysisState;
  /** Ranges the player edited on the grid, per seat (this hand only). */
  rangeOverrides: (Float32Array | null)[];
  /** The player's graded decisions this hand. */
  decisions: DecisionRecord[];
  /** The most recent graded decision (shown after acting). */
  lastReview: DecisionRecord | null;
  busy: boolean;
  error: string | null;

  load(): Promise<void>;
  startSession(settings: SessionSettings): Promise<void>;
  leaveTable(): void;
  dealNext(): Promise<void>;
  heroAct(action: Action): Promise<void>;
  setCoachMode(mode: CoachMode): void;
  setRevealStyles(reveal: boolean): void;
  setRangeOverride(seat: number, range: Float32Array | null): void;
};

export type GameStore = StoreApi<GameState>;

const IDLE: AnalysisState = { status: "idle", forEvents: -1, analysis: null, ranges: null, error: null };

export function modelLabel(state: Pick<GameState, "revealStyles" | "settings">, seat: number): string {
  if (!state.revealStyles || !state.settings) return "Population average";
  return PROFILES[state.settings.lineup[seat - 1]].name;
}

export function createGameStore({ core, botDelayMs = 600 }: { core: Core; botDelayMs?: number }): GameStore {
  // The analysis in flight for the current decision, so acting can wait for it.
  let pending: { handId: number; events: number; promise: Promise<Computed | null> } | null = null;

  type Computed = { analysis: DecisionAnalysis; ranges: Float32Array[]; foldCurves: NonNullable<AnalysisOptions["foldCurves"]> };

  const store = createStore<GameState>((set, get) => {
    const modelFor = (seat: number): Model => {
      const { profiles, revealStyles, settings } = get();
      return revealStyles && settings ? profileModel(profiles![settings.lineup[seat - 1]]) : populationModel(profiles!);
    };

    const isCurrent = (handId: number) => get().hand?.id === handId;

    /** Ranges (tracked, or edited), fold curves, then the analysis for the player's current decision. */
    async function compute(hand: HandProgress): Promise<Computed> {
      const { config, seed, view, strengths } = hand;
      const tracked = await trackRanges(core, config, seed, view.events, modelFor, strengths, { viewer: HERO });
      const overrides = get().rangeOverrides;
      const ranges = tracked.map((r, seat) => overrides[seat] ?? r);
      const opponents = liveRanges(ranges, hand);
      const known = [...(view.players[HERO].hole ?? []), ...view.board];
      const boardStrengths = view.board.length >= 3 ? await strengths.get(view.board) : null;
      const foldCurves = opponents.map(({ seat, range }) => ({
        seat,
        points: foldCurve(modelFor(seat), range, seat, view, config, boardStrengths, known),
      }));
      const analysis = await core.analyze({ config, seed, events: view.events, heroSeat: HERO, ranges: opponents, options: { foldCurves } });
      return { analysis, ranges, foldCurves };
    }

    function refreshAnalysis(): Promise<Computed | null> | null {
      const hand = get().hand;
      if (!hand || hand.view.legal?.seat !== HERO) return null;
      const events = hand.view.events.length;
      set({ analysis: { ...get().analysis, status: "loading", forEvents: events } });
      const promise = compute(hand).then(
        (result) => {
          if (isCurrent(hand.id) && get().hand!.view.events.length === events) {
            set({ analysis: { status: "ready", forEvents: events, analysis: result.analysis, ranges: result.ranges, error: null } });
          }
          return result;
        },
        (e: Error) => {
          if (isCurrent(hand.id)) set({ analysis: { ...IDLE, status: "error", forEvents: events, error: e.message } });
          return null;
        },
      );
      pending = { handId: hand.id, events, promise };
      return promise;
    }

    /** After every change: let a bot act, or analyse the player's decision. */
    function continueHand() {
      const hand = get().hand;
      const legal = hand?.view.legal;
      if (!hand || !legal) return;
      if (legal.seat === HERO) {
        void refreshAnalysis();
        return;
      }
      setTimeout(() => void botMove(hand.id), botDelayMs);
    }

    async function botMove(handId: number) {
      const hand = get().hand;
      if (!hand || hand.id !== handId || !hand.view.legal || hand.view.legal.seat === HERO) return;
      try {
        const seat = hand.view.legal.seat;
        const profile = get().profiles![get().settings!.lineup[seat - 1]];
        const { action } = await decide(profile, hand.config, hand.seed, hand.view, hand.strengths);
        const view = await core.applyAction(hand.config, hand.seed, hand.view.events, action);
        if (!isCurrent(handId)) return;
        set({ hand: { ...hand, view } });
        continueHand();
      } catch (e) {
        if (isCurrent(handId)) set({ error: (e as Error).message });
      }
    }

    return {
      screen: "setup",
      settings: null,
      coachMode: "always",
      revealStyles: false,
      profiles: null,
      hand: null,
      analysis: IDLE,
      rangeOverrides: [],
      decisions: [],
      lastReview: null,
      busy: false,
      error: null,

      async load() {
        if (get().profiles) return;
        try {
          set({ profiles: await compileProfiles(core) });
        } catch (e) {
          set({ error: `Couldn't load the bots: ${(e as Error).message}` });
        }
      },

      async startSession(settings) {
        await get().load();
        set({ settings, screen: "play", hand: null, lastReview: null, error: null });
        await get().dealNext();
      },

      leaveTable() {
        pending = null;
        set({ screen: "setup", hand: null, analysis: IDLE, decisions: [], lastReview: null, rangeOverrides: [] });
      },

      async dealNext() {
        const { settings, hand: previous } = get();
        if (!settings) return;
        const button = previous ? (previous.config.button + 1) % settings.tableSize : 0;
        const config = tableConfig(settings, button);
        const seed = randomSeed();
        try {
          const view = await core.newHand(config, seed);
          const hand: HandProgress = {
            id: (previous?.id ?? 0) + 1,
            number: (previous?.number ?? 0) + 1,
            config,
            seed,
            view,
            strengths: new StrengthCache(core),
          };
          set({ hand, analysis: IDLE, decisions: [], lastReview: null, rangeOverrides: [], error: null });
          continueHand();
        } catch (e) {
          set({ error: (e as Error).message });
        }
      },

      async heroAct(action) {
        const hand = get().hand;
        if (!hand || hand.view.legal?.seat !== HERO || get().busy) return;
        set({ busy: true });
        try {
          // The analysis of this decision (already running since the turn began).
          const events = hand.view.events.length;
          let computed =
            pending && pending.handId === hand.id && pending.events === events ? await pending.promise : await refreshAnalysis();
          if (!isCurrent(hand.id)) return;
          if (computed) {
            let analysis = computed.analysis;
            // A custom size the analysis didn't include: analyse it exactly.
            if (!analysis.evByAction.some((x) => sameAction(x.action, action))) {
              analysis = await core.analyze({
                config: hand.config,
                seed: hand.seed,
                events: hand.view.events,
                heroSeat: HERO,
                ranges: liveRanges(computed.ranges, hand),
                options: { foldCurves: computed.foldCurves, extraActions: [action] },
              });
              computed = { ...computed, analysis };
            }
            const record: DecisionRecord = {
              street: hand.view.street,
              analysis,
              chosen: action,
              grade: grade(analysis, action, hand.config.bigBlind),
              ranges: computed.ranges,
            };
            set({ decisions: [...get().decisions, record], lastReview: record });
          }
          const view = await core.applyAction(hand.config, hand.seed, hand.view.events, action);
          if (!isCurrent(hand.id)) return;
          set({ hand: { ...hand, view }, analysis: IDLE, error: null });
          continueHand();
        } catch (e) {
          set({ error: (e as Error).message });
        } finally {
          set({ busy: false });
        }
      },

      setCoachMode(mode) {
        set({ coachMode: mode });
      },

      setRevealStyles(reveal) {
        set({ revealStyles: reveal });
        void refreshAnalysis();
      },

      setRangeOverride(seat, range) {
        const overrides = [...get().rangeOverrides];
        overrides[seat] = range;
        set({ rangeOverrides: overrides });
        void refreshAnalysis();
      },
    };
  });

  return store;
}

/** The ranges of opponents still in the hand, in the form `analyze` takes. */
function liveRanges(ranges: Float32Array[], hand: HandProgress) {
  return hand.view.players
    .map((p, seat) => ({ p, seat }))
    .filter(({ p, seat }) => seat !== HERO && !p.folded)
    .map(({ seat }) => ({ seat, range: ranges[seat] }));
}
