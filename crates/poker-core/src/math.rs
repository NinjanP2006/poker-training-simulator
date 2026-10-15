//! The poker formulas from the plan's math reference, as pure functions.
//!
//! These mirror web/src/math/formulas.ts one for one (same names in
//! snake_case, same argument order), and both are tested against the shared
//! cases in fixtures/formulas.json.
//!
//! Symbols: P = pot before your decision (including any bet you face),
//! C = amount to call, B = a bet's size, E = equity, f = fold frequency.

/// Equity needed to call: C / (P + C).
pub fn pot_odds(pot: f64, to_call: f64) -> f64 {
    to_call / (pot + to_call)
}

/// Share of the pot won on average: wins plus a fractional share of ties.
pub fn equity(win: f64, tie: f64, players_in_tie: f64) -> f64 {
    win + tie / players_in_tie
}

/// EV of calling, relative to folding: E·P − (1 − E)·C.
pub fn ev_call(equity: f64, pot: f64, to_call: f64) -> f64 {
    equity * pot - (1.0 - equity) * to_call
}

/// EV of betting B into P, if the opponent folds with frequency f and
/// otherwise calls and the hand goes to showdown:
/// f·P + (1 − f)·(E_called·(P + 2B) − B).
pub fn ev_bet(pot: f64, bet: f64, fold_frequency: f64, equity_when_called: f64) -> f64 {
    fold_frequency * pot + (1.0 - fold_frequency) * (equity_when_called * (pot + 2.0 * bet) - bet)
}

/// How often a pure bluff of B into P must work to break even: B / (P + B).
pub fn bluff_break_even(pot: f64, bet: f64) -> f64 {
    bet / (pot + bet)
}

/// Minimum defense frequency against a bet of B into P. Here P is the pot
/// *before* the bet (unlike `pot_odds`): P / (P + B).
pub fn mdf(pot: f64, bet: f64) -> f64 {
    pot / (pot + bet)
}

/// Extra chips you'd need to win on later streets for a call to break even:
/// C/E − (P + C). `None` with zero equity (no amount is enough). Negative
/// means the call is already profitable on its own.
pub fn implied_odds(pot: f64, to_call: f64, equity: f64) -> Option<f64> {
    (equity != 0.0).then(|| to_call / equity - (pot + to_call))
}

/// n choose k.
pub fn choose(n: u64, k: u64) -> u64 {
    if k > n {
        return 0;
    }
    let k = k.min(n - k);
    (0..k).fold(1, |acc, i| acc * (n - i) / (i + 1))
}

/// Chance of hitting one of `outs` with one card to come (46 unseen on the
/// turn) or two (47 unseen on the flop). Panics for other counts.
pub fn outs(outs: u64, cards_to_come: u64) -> f64 {
    match cards_to_come {
        1 => outs as f64 / 46.0,
        2 => 1.0 - choose(47 - outs, 2) as f64 / choose(47, 2) as f64,
        _ => panic!("only 1 or 2 cards to come are supported"),
    }
}

/// Stack-to-pot ratio.
pub fn spr(effective_stack: f64, pot: f64) -> f64 {
    effective_stack / pot
}

/// Combos of a pocket pair with `n` cards of the rank unseen: C(n, 2).
pub fn pair_combos(unseen_of_rank: u64) -> u64 {
    choose(unseen_of_rank, 2)
}

/// Combos of an unpaired hand: n₁ · n₂.
pub fn unpaired_combos(unseen_rank_1: u64, unseen_rank_2: u64) -> u64 {
    unseen_rank_1 * unseen_rank_2
}
