// A bot's decision: look up the model's probabilities for its actual hand,
// make them legal, then sample with the hand's seed.

import { comboIndex } from "../core/combos";
import type { Action, HandView, LegalActions, TableConfig } from "../core/types";
import {
  type ActionClass,
  type CompiledProfile,
  effectiveProbs,
  profileModel,
  type Probs,
  rawProbs,
  type Situation,
  situationFor,
  type StrengthCache,
} from "./model";
import { seededRandom } from "./rng";

export type BotDecision = { action: Action; actionClass: ActionClass; probs: Probs; situation: Situation };

export async function decide(
  profile: CompiledProfile,
  config: TableConfig,
  seed: string,
  view: HandView,
  strengths: StrengthCache,
): Promise<BotDecision> {
  const legal = view.legal;
  if (!legal) throw new Error("nobody is due to act");
  const seat = legal.seat;
  const hole = view.players[seat].hole;
  if (!hole) throw new Error(`seat ${seat} has no cards`);

  const situation = situationFor(view, config, seat);
  const boardStrengths = situation.street === "postflop" ? await strengths.get(view.board) : null;
  const probs = effectiveProbs(rawProbs(profileModel(profile), situation, comboIndex(hole[0], hole[1]), boardStrengths), legal);

  const r = seededRandom(seed, view.events.length, seat);
  const actionClass: ActionClass = r < probs.fold ? "fold" : r < probs.fold + probs.passive ? "passive" : "aggressive";
  return { action: toAction(actionClass, profile, situation, view, legal, config), actionClass, probs, situation };
}

/** Turns an action class into a legal concrete action with the profile's sizing. */
function toAction(
  cls: ActionClass,
  profile: CompiledProfile,
  situation: Situation,
  view: HandView,
  legal: LegalActions,
  config: TableConfig,
): Action {
  if (cls === "fold") return legal.toCall > 0 ? { kind: "fold" } : { kind: "check" };
  if (cls === "passive" || legal.minRaiseTo === null) {
    return legal.toCall > 0 ? { kind: "call" } : { kind: "check" };
  }

  const bb = config.bigBlind;
  const post = profile.spec.postflop;
  let target: number;
  if (situation.street === "preflop") {
    target = {
      open: 2.5 * bb,
      option: 4 * bb,
      vsRaise: 3 * view.currentBet,
      vs3bet: 2.3 * view.currentBet,
    }[situation.spot];
  } else {
    target = situation.facingBet ? post.raiseMultiple * view.currentBet : post.betFraction * view.pot;
  }
  const to = Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, Math.round(target)));
  if (to === legal.maxRaiseTo) return { kind: "allIn" };
  return legal.isBet ? { kind: "bet", amount: to } : { kind: "raise", to };
}
