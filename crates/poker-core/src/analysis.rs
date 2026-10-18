//! Decision analysis: every number the math panel shows for one decision.
//!
//! Given a hand where it's hero's turn and a range for each opponent still in
//! the pot, [`analyze`] reports equity, pot odds, MDF, SPR, implied odds,
//! outs (clean and dirty) and an EV estimate for each sensible action.
//!
//! The EVs are **estimates**, following the plan's math reference: each one
//! treats the current street in isolation and assumes the hand then goes to
//! showdown with no more betting. Two inputs are models, not facts:
//!
//! - **Fold frequency.** Normally a fold curve per opponent, computed by the
//!   app from the opponent model and their current range (how often they
//!   fold to each price). Without one, opponents are assumed to fold
//!   [`POPULATION_FOLD_FACTOR`] times as often as a pure bluff of that size
//!   needs to break even, i.e. they call a bit too much.
//! - **Who calls.** An opponent who continues does so with the strongest part
//!   of their range: the combos hero has the least equity against.
//!
//! Multiway pots use Monte Carlo equity against all ranges for checking and
//! calling. For bets, everyone folding wins the pot; otherwise one opponent is
//! assumed to call: the one whose calling range hero does worst against.
//! Outs are skipped multiway.

use std::fmt;

use crate::card::Card;
use crate::engine::{Action, HandState, LegalActions, PlayerState, Street};
use crate::equity::{self, ComboEquity, EquityError, EquityOptions, EquityResult};
use crate::eval::fast;
use crate::mask::CardMask;
use crate::math;
use crate::range::{Range, combo_mask};

/// Bet and raise sizes to evaluate, as fractions of the pot after calling.
pub const DEFAULT_BET_FRACTIONS: [f64; 4] = [1.0 / 3.0, 0.5, 0.75, 1.0];

/// Placeholder opponent model: fold this many times as often as a pure bluff
/// needs to break even. Below 1, so pure bluffs lose a little by default.
pub const POPULATION_FOLD_FACTOR: f64 = 0.85;

/// An out is "dirty" if at least this share of the opponent's range still
/// beats hero after it comes.
pub const DIRTY_OUT_SHARE: f64 = 0.2;

/// Multiway: per-opponent breakdowns enumerate exactly only up to this many
/// evaluations, and otherwise sample with this budget.
const MULTIWAY_EXACT_LIMIT: u64 = 250_000;
const MULTIWAY_PER_COMBO_BUDGET: u64 = 120_000;

#[derive(Clone, Debug, PartialEq)]
pub struct AnalysisOptions {
    pub equity: EquityOptions,
    /// Bet/raise sizes as fractions of the pot after calling. All-in is always added.
    pub bet_fractions: Vec<f64>,
    /// Override the fold frequency (per opponent) for every bet and raise.
    pub fold_frequency: Option<f64>,
    /// Also evaluate these actions if legal, e.g. the size the player actually chose.
    pub extra_actions: Vec<Action>,
    /// Per opponent seat: how often they fold to a bet, as points
    /// (pot odds offered, fold frequency), sorted by pot odds. Comes from the
    /// opponent model and their current range; replaces the placeholder.
    pub fold_curves: Vec<(usize, Vec<(f64, f64)>)>,
}

impl Default for AnalysisOptions {
    fn default() -> AnalysisOptions {
        AnalysisOptions {
            equity: EquityOptions::default(),
            bet_fractions: DEFAULT_BET_FRACTIONS.to_vec(),
            fold_frequency: None,
            extra_actions: Vec::new(),
            fold_curves: Vec::new(),
        }
    }
}

/// One action and its estimated value.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ActionEv {
    pub action: Action,
    /// Estimated EV in chips, relative to folding now (so folding is 0).
    pub ev: f64,
    /// Bets and raises: assumed chance that every opponent folds.
    pub fold_frequency: Option<f64>,
    /// Bets and raises: how often a pure bluff of this size must work.
    pub break_even_fold: Option<f64>,
    /// Bets and raises: hero's equity against the hands that continue.
    pub equity_when_called: Option<f64>,
}

impl ActionEv {
    fn passive(action: Action, ev: f64) -> ActionEv {
        ActionEv {
            action,
            ev,
            fold_frequency: None,
            break_even_fold: None,
            equity_when_called: None,
        }
    }
}

/// Cards that would put hero ahead of most of the opponent's range.
#[derive(Clone, Debug, PartialEq)]
pub struct Outs {
    /// Outs after which little of the range still beats hero.
    pub clean: Vec<Card>,
    /// Outs that improve hero but still leave at least [`DIRTY_OUT_SHARE`] of
    /// the range ahead (e.g. they pair the board and fill up a set).
    pub dirty: Vec<Card>,
    /// Cards hero can't see: 47 on the flop, 46 on the turn.
    pub unseen: u32,
    /// Chance the next card is an out (clean or dirty).
    pub next_card: f64,
    /// On the flop: chance of hitting an out by the river.
    pub by_river: Option<f64>,
    /// The shortcut: Rule of 4 on the flop (two cards to come), Rule of 2 on the turn.
    pub rule_of_thumb: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DecisionAnalysis {
    pub street: Street,
    pub hero: usize,
    /// Opponents still in the pot.
    pub opponents: usize,
    /// P: chips in the pot, including any bet hero faces.
    pub pot: u64,
    /// C: chips hero needs to call (0 means hero can check).
    pub to_call: u64,
    /// The smaller of hero's stack and the biggest opponent stack (chips behind).
    pub effective_stack: u64,
    pub equity: EquityResult,
    /// Equity needed to call: C / (P + C), or 0 with nothing to call.
    pub pot_odds: f64,
    /// Facing a bet: how much of hero's range should continue.
    pub mdf: Option<f64>,
    pub spr: f64,
    /// Facing a bet: extra chips hero must win later to justify calling (0 if
    /// the call already pays). `None` with nothing to call or zero equity.
    pub implied_odds_needed: Option<f64>,
    /// Flop and turn, heads-up, when hero is behind; otherwise `None`.
    pub outs: Option<Outs>,
    pub actions: Vec<ActionEv>,
}

impl DecisionAnalysis {
    /// The action with the highest estimated EV.
    pub fn best(&self) -> &ActionEv {
        self.actions
            .iter()
            .max_by(|a, b| a.ev.total_cmp(&b.ev))
            .expect("there is always at least one action")
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AnalysisError {
    /// The hand isn't waiting on hero.
    NotHerosTurn,
    /// No range was given for this opponent seat.
    MissingRange(usize),
    Equity(EquityError),
}

impl fmt::Display for AnalysisError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AnalysisError::NotHerosTurn => write!(f, "it isn't hero's turn to act"),
            AnalysisError::MissingRange(seat) => {
                write!(f, "no range given for opponent seat {seat}")
            }
            AnalysisError::Equity(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for AnalysisError {}

impl From<EquityError> for AnalysisError {
    fn from(e: EquityError) -> AnalysisError {
        AnalysisError::Equity(e)
    }
}

/// Analyzes hero's current decision. `ranges` gives (seat, range) for each
/// opponent still in the pot; extra entries are ignored.
pub fn analyze(
    hand: &HandState,
    hero: usize,
    ranges: &[(usize, Range)],
    opts: &AnalysisOptions,
) -> Result<DecisionAnalysis, AnalysisError> {
    let legal = hand
        .legal_actions()
        .filter(|l| l.seat == hero)
        .ok_or(AnalysisError::NotHerosTurn)?;
    let players = hand.players();
    let me = &players[hero];
    let hole = me.hole.expect("hole cards are dealt before anyone acts");
    let board = hand.board();

    let opponents: Vec<usize> = (0..players.len())
        .filter(|&s| s != hero && !players[s].folded)
        .collect();
    let villain_ranges: Vec<Range> = opponents
        .iter()
        .map(|&s| {
            ranges
                .iter()
                .find(|(seat, _)| *seat == s)
                .map(|(_, r)| r.clone())
                .ok_or(AnalysisError::MissingRange(s))
        })
        .collect::<Result<_, _>>()?;

    let none = CardMask::empty();
    // Hero's equity against each opponent's combos, heads-up. Used to work out
    // how strong the hands that call a bet are. Multiway, these only feed a
    // rough scaling factor, so they get a smaller budget per opponent.
    let per_opponent_opts = if villain_ranges.len() > 1 {
        EquityOptions {
            exact_limit: opts.equity.exact_limit.min(MULTIWAY_EXACT_LIMIT),
            per_combo_budget: opts.equity.per_combo_budget.min(MULTIWAY_PER_COMBO_BUDGET),
            ..opts.equity
        }
    } else {
        opts.equity
    };
    let per_opponent: Vec<equity::EquityByCombo> = villain_ranges
        .iter()
        .map(|r| equity::equity_by_combo(hole, r, board, none, &per_opponent_opts))
        .collect::<Result<_, _>>()?;
    let equity = if let [heads_up] = per_opponent.as_slice() {
        heads_up.result
    } else {
        equity::equity_multiway(hole, &villain_ranges, board, none, &opts.equity)?
    };

    let pot = hand.pot();
    let to_call = legal.to_call;
    let e = equity.equity;
    let biggest_opponent_stack = opponents
        .iter()
        .map(|&s| players[s].stack)
        .max()
        .unwrap_or(0);
    let effective_stack = me.stack.min(biggest_opponent_stack);

    let ctx = EvContext {
        hand,
        hero,
        opponents: opponents.iter().map(|&s| (s, &players[s])).collect(),
        pot: pot as f64,
        equity: e,
        per_opponent: &per_opponent,
        fold_override: opts.fold_frequency,
        fold_curves: &opts.fold_curves,
    };
    let actions = candidate_actions(hand, &legal, opts)
        .into_iter()
        .map(|a| ctx.ev(a))
        .collect();

    let outs = match (villain_ranges.as_slice(), board.len()) {
        ([range], 3 | 4) => find_outs(hole, range, board),
        _ => None,
    };

    Ok(DecisionAnalysis {
        street: hand.street(),
        hero,
        opponents: opponents.len(),
        pot,
        to_call,
        effective_stack,
        equity,
        pot_odds: if to_call > 0 {
            math::pot_odds(pot as f64, to_call as f64)
        } else {
            0.0
        },
        // The bet hero faces is C, made into a pot of P − C.
        mdf: (to_call > 0).then(|| math::mdf(pot.saturating_sub(to_call) as f64, to_call as f64)),
        spr: math::spr(effective_stack as f64, pot as f64),
        implied_odds_needed: if to_call > 0 {
            math::implied_odds(pot as f64, to_call as f64, e).map(|x| x.max(0.0))
        } else {
            None
        },
        outs,
        actions,
    })
}

/// Fold/check/call, bets or raises at each configured pot fraction, all-in,
/// and any requested extra actions that are legal.
fn candidate_actions(
    hand: &HandState,
    legal: &LegalActions,
    opts: &AnalysisOptions,
) -> Vec<Action> {
    let mut actions = Vec::new();
    if legal.to_call > 0 {
        actions.push(Action::Fold);
        actions.push(Action::Call);
    } else {
        actions.push(Action::Check);
    }

    if let Some(min) = legal.min_raise_to {
        // A raise of fraction f puts in f × (the pot after calling) on top of the current bet.
        let base = hand.current_bet() as f64;
        let pot_after_call = (hand.pot() + legal.to_call) as f64;
        let mut totals: Vec<u64> = opts
            .bet_fractions
            .iter()
            .map(|f| ((base + f * pot_after_call).round() as u64).clamp(min, legal.max_raise_to))
            .filter(|&t| t < legal.max_raise_to) // all-in is added separately
            .collect();
        totals.sort_unstable();
        totals.dedup();
        for to in totals {
            actions.push(if legal.is_bet {
                Action::Bet { amount: to }
            } else {
                Action::Raise { to }
            });
        }
        actions.push(Action::AllIn);
    }

    for &extra in &opts.extra_actions {
        if legal.check(&extra).is_ok() && !actions.contains(&extra) {
            actions.push(extra);
        }
    }
    actions
}

struct EvContext<'a> {
    hand: &'a HandState,
    hero: usize,
    /// (seat, state) of each opponent still in the pot.
    opponents: Vec<(usize, &'a PlayerState)>,
    pot: f64,
    equity: f64,
    per_opponent: &'a [equity::EquityByCombo],
    fold_override: Option<f64>,
    fold_curves: &'a [(usize, Vec<(f64, f64)>)],
}

impl EvContext<'_> {
    fn me(&self) -> &PlayerState {
        &self.hand.players()[self.hero]
    }

    /// Who calls a bet, and hero's equity against them, when opponent `i`
    /// folds `folds[i]` of their range.
    ///
    /// Heads-up this is exact for the model. Multiway, a called bet is assumed
    /// to face one caller: the opponent whose calling range hero does worst
    /// against. (Most called bets get one caller; assuming everyone calls with
    /// their strongest hands made hero's equity look absurdly low.)
    fn toughest_caller(&self, folds: &[f64]) -> (usize, f64) {
        self.per_opponent
            .iter()
            .zip(folds)
            .map(|(opponent, &fold)| equity_when_called(&opponent.combos, fold))
            .enumerate()
            .min_by(|a, b| a.1.total_cmp(&b.1))
            .expect("there is at least one opponent")
    }

    /// How often this opponent folds to a bet that offers them `pot_odds`:
    /// the explicit override if set, else their fold curve, else the
    /// population placeholder.
    fn fold_probability(&self, seat: usize, pot_odds: f64, break_even: f64) -> f64 {
        if let Some(f) = self.fold_override {
            return f.clamp(0.0, 1.0);
        }
        match self.fold_curves.iter().find(|(s, _)| *s == seat) {
            Some((_, curve)) => interpolate(curve, pot_odds).clamp(0.0, 1.0),
            None => (POPULATION_FOLD_FACTOR * break_even).clamp(0.0, 1.0),
        }
    }

    fn ev(&self, action: Action) -> ActionEv {
        let me = self.me();
        let new_total = match action {
            Action::Fold => return ActionEv::passive(action, 0.0),
            // Checking keeps the current pot and (by assumption) goes to showdown.
            Action::Check => return ActionEv::passive(action, self.equity * self.pot),
            Action::Call => None,
            Action::Bet { amount } => Some(amount),
            Action::Raise { to } => Some(to),
            Action::AllIn => Some(me.street_bet + me.stack),
        };
        match new_total {
            Some(to) if to > self.hand.current_bet() => self.ev_aggressive(action, to),
            _ => self.ev_call(action), // a call, or an all-in that is only a call
        }
    }

    fn ev_call(&self, action: Action) -> ActionEv {
        let me = self.me();
        let owed = self.hand.current_bet().saturating_sub(me.street_bet);
        let call = owed.min(me.stack);
        // If hero is all-in for less, chips opponents bet beyond hero's total come back to them.
        let hero_total = me.street_bet + call;
        let returned: u64 = self
            .opponents
            .iter()
            .map(|(_, o)| o.street_bet.saturating_sub(hero_total))
            .sum();
        let pot = self.pot - returned as f64;
        ActionEv::passive(action, math::ev_call(self.equity, pot, call as f64))
    }

    fn ev_aggressive(&self, action: Action, to: u64) -> ActionEv {
        let me = self.me();
        let risk = to - me.street_bet;
        let break_even = math::bluff_break_even(self.pot, risk as f64);

        // What each opponent would put in to call (as much as their stack allows).
        let calls: Vec<u64> = self
            .opponents
            .iter()
            .map(|(_, o)| to.saturating_sub(o.street_bet).min(o.stack))
            .collect();

        // Chance each opponent folds (given the price this bet offers them),
        // then the chance they all do. A player who is all-in can't fold.
        let folds: Vec<f64> = self
            .opponents
            .iter()
            .zip(&calls)
            .map(|((seat, _), &call)| {
                let pot_odds = call as f64 / (self.pot + risk as f64 + call as f64);
                self.fold_probability(*seat, pot_odds, break_even)
            })
            .collect();
        let all_fold = if self.opponents.iter().any(|(_, o)| o.stack == 0) {
            0.0
        } else {
            folds.iter().product()
        };

        // If called: the caller matches as much of the bet as they can, and any
        // of hero's bet they can't match comes back.
        let (caller, equity_called) = self.toughest_caller(&folds);
        let caller_total = self.opponents[caller].1.street_bet + calls[caller];
        let hero_in = to.min(caller_total) - me.street_bet;
        let pot_if_called = self.pot + hero_in as f64 + calls[caller] as f64;
        let ev = all_fold * self.pot
            + (1.0 - all_fold) * (equity_called * pot_if_called - hero_in as f64);

        ActionEv {
            action,
            ev,
            fold_frequency: Some(all_fold),
            break_even_fold: Some(break_even),
            equity_when_called: Some(equity_called),
        }
    }
}

/// Linear interpolation through `points` (sorted by x), flat beyond the ends.
fn interpolate(points: &[(f64, f64)], x: f64) -> f64 {
    match points {
        [] => 0.0,
        [(_, y)] => *y,
        _ => {
            let (first, last) = (points[0], points[points.len() - 1]);
            if x <= first.0 {
                return first.1;
            }
            if x >= last.0 {
                return last.1;
            }
            let i = points.partition_point(|p| p.0 <= x);
            let ((x0, y0), (x1, y1)) = (points[i - 1], points[i]);
            y0 + (y1 - y0) * (x - x0) / (x1 - x0)
        }
    }
}

/// Hero's equity against the part of the range that continues when the
/// opponent folds `fold` of it: they fold the hands hero is doing best
/// against and keep the rest.
fn equity_when_called(combos: &[ComboEquity], fold: f64) -> f64 {
    let total: f64 = combos.iter().map(|c| c.weight as f64).sum();
    let mut keep = (1.0 - fold).clamp(0.0, 1.0) * total;
    if keep <= 0.0 {
        // Nobody calls; the value is never used, but return the full-range number.
        return combos
            .iter()
            .map(|c| c.weight as f64 * c.equity())
            .sum::<f64>()
            / total;
    }
    let mut strongest_first: Vec<&ComboEquity> = combos.iter().collect();
    strongest_first.sort_by(|a, b| a.equity().total_cmp(&b.equity()));

    let (mut weight, mut sum) = (0.0, 0.0);
    for c in strongest_first {
        let w = (c.weight as f64).min(keep);
        if w <= 0.0 {
            break;
        }
        weight += w;
        sum += w * c.equity();
        keep -= w;
    }
    sum / weight
}

/// Outs, found by checking every unseen card against the opponent's range
/// rather than counting. Only reported when hero is behind most of the range.
fn find_outs(hole: [Card; 2], range: &Range, board: &[Card]) -> Option<Outs> {
    let hero: CardMask = hole.into_iter().collect();
    let board_mask: CardMask = board.iter().copied().collect();
    let known = hero.union(board_mask);
    let live: Vec<(CardMask, f64)> = range
        .combos()
        .map(|(i, _, w)| (combo_mask(i), w as f64))
        .filter(|(m, _)| !m.intersects(known))
        .collect();

    // On a given board: (share of the range hero beats, with ties as half;
    // share that beats hero). `None` if no combo is possible with that board.
    let standing = |board: CardMask| -> Option<(f64, f64)> {
        let hero_rank = fast::eval_mask(hero.union(board));
        let (mut total, mut ahead, mut behind) = (0.0, 0.0, 0.0);
        for &(combo, w) in &live {
            if combo.intersects(board) {
                continue;
            }
            let rank = fast::eval_mask(combo.union(board));
            total += w;
            if hero_rank > rank {
                ahead += w;
            } else if hero_rank == rank {
                ahead += w / 2.0;
            } else {
                behind += w;
            }
        }
        (total > 0.0).then(|| (ahead / total, behind / total))
    };

    let (ahead_now, _) = standing(board_mask)?;
    if ahead_now >= 0.5 {
        return None; // hero is ahead already; outs don't apply
    }

    let (mut clean, mut dirty) = (Vec::new(), Vec::new());
    for card in CardMask::FULL_DECK.iter().filter(|&c| !known.contains(c)) {
        let mut next = board_mask;
        next.insert(card);
        if let Some((ahead, behind)) = standing(next)
            && ahead >= 0.5
        {
            if behind >= DIRTY_OUT_SHARE {
                dirty.push(card);
            } else {
                clean.push(card);
            }
        }
    }

    let unseen = (52 - 2 - board.len()) as u64;
    let n = (clean.len() + dirty.len()) as u64;
    let on_flop = board.len() == 3;
    Some(Outs {
        clean,
        dirty,
        unseen: unseen as u32,
        next_card: n as f64 / unseen as f64,
        by_river: on_flop
            .then(|| 1.0 - math::choose(unseen - n, 2) as f64 / math::choose(unseen, 2) as f64),
        rule_of_thumb: if on_flop { 4.0 } else { 2.0 } * n as f64 / 100.0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{Deck, TableConfig};

    fn cards(s: &str) -> Vec<Card> {
        s.split_whitespace().map(|c| c.parse().unwrap()).collect()
    }

    fn range(s: &str) -> Range {
        Range::parse(s).unwrap()
    }

    fn heads_up(deck: &str) -> HandState {
        let config = TableConfig {
            stacks: vec![1000, 1000],
            small_blind: 1,
            big_blind: 2,
            button: 0,
        };
        HandState::with_deck(config, Deck::stacked(&cards(deck))).unwrap()
    }

    fn act(hand: &mut HandState, action: Action) {
        hand.apply_action(action).unwrap();
    }

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    /// Heads-up, button seat 0. Seat 1 is dealt Qs Qd, seat 0 (hero) Ah Kh.
    /// Preflop: raise to 50, call (pot 100). Flop Qh 7h 2c: seat 1 bets 75.
    fn facing_75_into_100() -> HandState {
        let mut hand = heads_up("Qs Qd Ah Kh Qh 7h 2c");
        act(&mut hand, Action::Raise { to: 50 });
        act(&mut hand, Action::Call);
        act(&mut hand, Action::Bet { amount: 75 });
        hand
    }

    #[test]
    fn facing_a_bet_matches_the_worked_examples() {
        let hand = facing_75_into_100();
        let ranges = [(1, range("QsQd, KsKd"))];
        let a = analyze(&hand, 0, &ranges, &AnalysisOptions::default()).unwrap();

        assert_eq!((a.street, a.pot, a.to_call), (Street::Flop, 175, 75));
        assert!(close(a.pot_odds, 75.0 / 250.0));
        assert!(close(a.mdf.unwrap(), 100.0 / 175.0)); // "facing 75 into 100, defend 57.1%"
        assert_eq!(a.effective_stack, 1000 - 50 - 75);

        // Calling's EV is the plan's formula with the computed equity.
        let call = a.actions.iter().find(|x| x.action == Action::Call).unwrap();
        assert!(close(call.ev, math::ev_call(a.equity.equity, 175.0, 75.0)));
        let fold = a.actions.iter().find(|x| x.action == Action::Fold).unwrap();
        assert_eq!(fold.ev, 0.0);

        let implied = a.implied_odds_needed.unwrap();
        let raw = math::implied_odds(175.0, 75.0, a.equity.equity).unwrap();
        assert!(close(implied, raw.max(0.0)));
    }

    #[test]
    fn outs_are_found_by_checking_each_card_against_the_range() {
        // Hero AhKh on Qh 7h 2c against a set of queens or an overpair of kings.
        let hand = facing_75_into_100();
        let ranges = [(1, range("QsQd, KsKd"))];
        let outs = analyze(&hand, 0, &ranges, &AnalysisOptions::default())
            .unwrap()
            .outs
            .unwrap();

        // Any heart that doesn't pair the board makes a flush that beats both hands.
        assert_eq!(outs.clean, cards("3h 4h 5h 6h 8h 9h Th Jh"));
        // 2h makes the flush but fills up the set; an ace beats the kings but not the set.
        assert_eq!(outs.dirty, cards("2h Ac Ad As"));
        assert_eq!(outs.unseen, 47);
        assert!(close(outs.next_card, 12.0 / 47.0));
        assert!(close(outs.by_river.unwrap(), 1.0 - 595.0 / 1081.0)); // 1 − C(35,2)/C(47,2)
        assert!(close(outs.rule_of_thumb, 0.48));
    }

    #[test]
    fn no_outs_when_already_ahead() {
        // Seat 1 is hero this time, holding the set of queens.
        let mut hand = heads_up("Qs Qd Ah Kh Qh 7h 2c");
        act(&mut hand, Action::Call);
        act(&mut hand, Action::Check);
        let a = analyze(
            &hand,
            1,
            &[(0, range("AhKh, JJ"))],
            &AnalysisOptions::default(),
        )
        .unwrap();
        assert!(a.equity.equity > 0.5);
        assert_eq!(a.outs, None);
    }

    #[test]
    fn bet_ev_matches_the_formula_when_fold_frequency_is_given() {
        // Seat 1 acts first on the flop with nothing to call. Against a
        // single combo, the calling range is that combo, so E_called = E.
        let mut hand = heads_up("Qs Qd Ah Kh Qh 7h 2c");
        act(&mut hand, Action::Call);
        act(&mut hand, Action::Check);
        let opts = AnalysisOptions {
            fold_frequency: Some(0.4),
            ..AnalysisOptions::default()
        };
        let a = analyze(&hand, 1, &[(0, range("AhKh"))], &opts).unwrap();
        assert_eq!((a.pot, a.to_call, a.mdf), (4, 0, None));

        let check = a
            .actions
            .iter()
            .find(|x| x.action == Action::Check)
            .unwrap();
        assert!(close(check.ev, a.equity.equity * 4.0));

        let bets: Vec<&ActionEv> = a
            .actions
            .iter()
            .filter(|x| matches!(x.action, Action::Bet { .. }))
            .collect();
        assert!(!bets.is_empty());
        for bet in bets {
            let Action::Bet { amount } = bet.action else {
                unreachable!()
            };
            let expected = math::ev_bet(4.0, amount as f64, 0.4, a.equity.equity);
            assert!(
                close(bet.ev, expected),
                "bet {amount}: {} vs {expected}",
                bet.ev
            );
            assert!(close(
                bet.break_even_fold.unwrap(),
                math::bluff_break_even(4.0, amount as f64)
            ));
        }
    }

    #[test]
    fn fold_curves_set_each_bets_fold_frequency_by_the_price_it_offers() {
        // Hero (seat 1) bets into a limped pot of 4; seat 0 folds 60% to cheap
        // prices and 20% to expensive ones.
        let mut hand = heads_up("Qs Qd Ah Kh Qh 7h 2c");
        act(&mut hand, Action::Call);
        act(&mut hand, Action::Check);
        let curve = vec![(0.2, 0.2), (0.4, 0.6)];
        let opts = AnalysisOptions {
            fold_curves: vec![(0, curve.clone())],
            ..AnalysisOptions::default()
        };
        let a = analyze(&hand, 1, &[(0, range("AhKh"))], &opts).unwrap();
        for x in a
            .actions
            .iter()
            .filter(|x| matches!(x.action, Action::Bet { .. }))
        {
            let Action::Bet { amount } = x.action else {
                unreachable!()
            };
            let b = amount as f64;
            let pot_odds = b / (4.0 + 2.0 * b); // calling b into a pot of 4 + b
            let expected = interpolate(&curve, pot_odds);
            assert!(close(x.fold_frequency.unwrap(), expected), "bet {amount}");
            assert!(close(x.ev, math::ev_bet(4.0, b, expected, a.equity.equity)));
        }
    }

    #[test]
    fn interpolation_is_linear_and_flat_at_the_ends() {
        let pts = [(0.2, 0.2), (0.4, 0.6)];
        assert!(close(interpolate(&pts, 0.3), 0.4));
        assert!(close(interpolate(&pts, 0.1), 0.2));
        assert!(close(interpolate(&pts, 0.9), 0.6));
        assert!(close(interpolate(&[(0.5, 0.3)], 0.1), 0.3));
    }

    #[test]
    fn default_fold_model_is_a_bit_below_break_even() {
        let hand = facing_75_into_100();
        let a = analyze(
            &hand,
            0,
            &[(1, range("QsQd, KsKd"))],
            &AnalysisOptions::default(),
        )
        .unwrap();
        for x in a
            .actions
            .iter()
            .filter(|x| matches!(x.action, Action::Raise { .. }))
        {
            let f = x.fold_frequency.unwrap();
            assert!(close(
                f,
                POPULATION_FOLD_FACTOR * x.break_even_fold.unwrap()
            ));
        }
    }

    #[test]
    fn offers_fold_call_raises_and_all_in_within_legal_limits() {
        let hand = facing_75_into_100();
        let extra = Action::Raise { to: 333 };
        let opts = AnalysisOptions {
            extra_actions: vec![extra, Action::Raise { to: 5 }], // the second is illegal
            ..AnalysisOptions::default()
        };
        let a = analyze(&hand, 0, &[(1, range("QQ+"))], &opts).unwrap();
        let actions: Vec<Action> = a.actions.iter().map(|x| x.action).collect();
        assert_eq!(&actions[..2], &[Action::Fold, Action::Call]);
        assert!(actions.contains(&Action::AllIn));
        assert!(actions.contains(&extra));
        assert!(!actions.contains(&Action::Raise { to: 5 }));
        let legal = hand.legal_actions().unwrap();
        let mut last = 0;
        for x in &a.actions {
            assert!(legal.check(&x.action).is_ok(), "{:?} isn't legal", x.action);
            if let Action::Raise { to } = x.action
                && x.action != extra
            {
                assert!(to > last, "raise sizes should increase");
                last = to;
            }
        }
    }

    #[test]
    fn calling_range_is_never_weaker_than_the_whole_range() {
        let combos = [(0.9, 1.0), (0.5, 1.0), (0.1, 2.0)].map(|(e, w)| ComboEquity {
            combo: 0,
            weight: w,
            win: e,
            tie: 0.0,
        });
        let all = (0.9 + 0.5 + 0.2) / 4.0;
        assert!(close(equity_when_called(&combos, 0.0), all));
        // Folding a quarter of the weight drops the 0.9 combo first.
        assert!(close(equity_when_called(&combos, 0.25), (0.5 + 0.2) / 3.0));
        // Folding half keeps only the strongest (0.1) hands.
        assert!(close(equity_when_called(&combos, 0.5), 0.1));
        for f in [0.1, 0.3, 0.6, 0.9] {
            assert!(equity_when_called(&combos, f) <= all + 1e-12);
        }
    }

    #[test]
    fn multiway_uses_monte_carlo_and_skips_outs() {
        let config = TableConfig {
            stacks: vec![500, 500, 500],
            small_blind: 1,
            big_blind: 2,
            button: 0,
        };
        let mut hand = HandState::new(config, 7).unwrap();
        act(&mut hand, Action::Call); // seat 0
        act(&mut hand, Action::Call); // seat 1
        act(&mut hand, Action::Check); // seat 2
        let hero = hand.to_act().unwrap();
        let ranges: Vec<(usize, Range)> = (0..3).map(|s| (s, range("22+, A2s+, KTo+"))).collect();
        let a = analyze(&hand, hero, &ranges, &AnalysisOptions::default()).unwrap();
        assert_eq!(a.opponents, 2);
        assert_eq!(a.outs, None);
        assert!(a.equity.std_err.is_some());
        assert!(a.actions.iter().all(|x| x.ev.is_finite()));
    }

    #[test]
    fn preflop_analysis_samples_and_stays_consistent() {
        let hand = heads_up("Qs Qd Ah Kh");
        let a = analyze(
            &hand,
            0,
            &[(1, range("22+, A2s+, K9s+, ATo+, KJo+"))],
            &AnalysisOptions::default(),
        )
        .unwrap();
        assert_eq!(a.street, Street::Preflop);
        assert_eq!((a.pot, a.to_call), (3, 1));
        for x in a.actions.iter().filter(|x| x.equity_when_called.is_some()) {
            // Allow for sampling noise between the overall and per-combo estimates.
            assert!(x.equity_when_called.unwrap() <= a.equity.equity + 0.03);
        }
    }

    #[test]
    fn errors_are_reported() {
        let hand = facing_75_into_100();
        let opts = AnalysisOptions::default();
        assert_eq!(
            analyze(&hand, 1, &[(0, range("AA"))], &opts),
            Err(AnalysisError::NotHerosTurn)
        );
        assert_eq!(
            analyze(&hand, 0, &[], &opts),
            Err(AnalysisError::MissingRange(1))
        );
        // Every combo in this range uses the Ah hero holds.
        assert_eq!(
            analyze(&hand, 0, &[(1, range("AhAd"))], &opts),
            Err(AnalysisError::Equity(EquityError::NoLiveCombos))
        );
    }

    /// Top pair in a small pot with deep stacks: shoving 30+ pots is only
    /// called by hands that beat top pair, so it must not look best. (The
    /// first multiway model rated this shove at +103 chips.)
    #[test]
    fn huge_overbets_are_not_favored_heads_up_or_multiway() {
        let wide = "22+, A2s+, K9s+, ATo+, KJo+, QJs, JTs";
        let opts = AnalysisOptions::default();

        // Heads-up: seat 1 (hero, AsKd) acts first on Ks 7d 2c after a limped pot.
        let config = TableConfig {
            stacks: vec![200, 200],
            small_blind: 1,
            big_blind: 2,
            button: 0,
        };
        let mut hand =
            HandState::with_deck(config, Deck::stacked(&cards("As Kd 8h 8s Ks 7d 2c"))).unwrap();
        act(&mut hand, Action::Call);
        act(&mut hand, Action::Check);
        let a = analyze(&hand, 1, &[(0, range(wide))], &opts).unwrap();
        assert!(a.equity.equity > 0.6);
        assert_ne!(a.best().action, Action::AllIn, "heads-up: {:?}", a.actions);

        // Three-handed: deal order 1, 2, 0; everyone limps, hero (seat 1) acts first on the flop.
        let config = TableConfig {
            stacks: vec![200, 200, 200],
            small_blind: 1,
            big_blind: 2,
            button: 0,
        };
        let mut hand =
            HandState::with_deck(config, Deck::stacked(&cards("As Kd 8h 8s 5c 4c Ks 7d 2c")))
                .unwrap();
        act(&mut hand, Action::Call);
        act(&mut hand, Action::Call);
        act(&mut hand, Action::Check);
        let ranges = [(0, range(wide)), (2, range(wide))];
        let a = analyze(&hand, 1, &ranges, &opts).unwrap();
        let shove = a
            .actions
            .iter()
            .find(|x| x.action == Action::AllIn)
            .unwrap();
        assert_ne!(a.best().action, Action::AllIn, "multiway: {:?}", a.actions);
        assert!(
            shove.equity_when_called.unwrap() < a.equity.equity,
            "callers of a shove should be stronger"
        );
    }

    #[test]
    fn best_picks_the_highest_ev() {
        let hand = facing_75_into_100();
        let a = analyze(
            &hand,
            0,
            &[(1, range("QsQd, KsKd"))],
            &AnalysisOptions::default(),
        )
        .unwrap();
        let max = a.actions.iter().map(|x| x.ev).fold(f64::MIN, f64::max);
        assert_eq!(a.best().ev, max);
    }
}
