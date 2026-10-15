//! Equity: your average share of the pot if all remaining cards are dealt,
//! against an opponent's range. Ties count as fractional wins.
//!
//! **Exact enumeration** walks every runout (every way to deal the remaining
//! board cards) against every live combo in the range. Each live combo is left
//! with the same number of possible runouts, so every (combo, runout) pair is
//! equally likely apart from the combo's weight.
//!
//! **Monte Carlo** samples a weighted random combo and a random runout, over
//! and over, and reports the average with a standard error. It runs until the
//! standard error is small enough or the time budget runs out.
//!
//! `equity` picks between them by estimating the work first: under the budget
//! (about 2M evaluations, which covers every river and turn spot and most flop
//! spots) it enumerates exactly; otherwise it samples.

use std::collections::{HashMap, VecDeque};
use std::fmt;

use rand_chacha::ChaCha8Rng;
use rand_chacha::rand_core::{Rng, SeedableRng};
use web_time::Instant;

use crate::card::Card;
use crate::eval::{HandRank, fast};
use crate::mask::CardMask;
use crate::range::{Range, combo_mask};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EquityOptions {
    /// Monte Carlo stops after this long, even if `max_std_err` isn't reached.
    pub budget_ms: f64,
    /// Monte Carlo stops once its standard error falls below this (0.005 = 0.5%).
    pub max_std_err: f64,
    /// Enumerate exactly when the estimated number of evaluations is at most
    /// this. Set to 0 to always use Monte Carlo.
    pub exact_limit: u64,
    /// Monte Carlo never takes more samples than this.
    pub max_samples: u64,
    /// Seed for Monte Carlo sampling, so a given request is reproducible.
    pub seed: u64,
}

impl Default for EquityOptions {
    fn default() -> EquityOptions {
        EquityOptions {
            budget_ms: 80.0,
            max_std_err: 0.005,
            exact_limit: 2_000_000,
            max_samples: u64::MAX,
            seed: 0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Method {
    Exact,
    MonteCarlo,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EquityResult {
    /// Share of the pot won on average: `win + (tied share)`.
    pub equity: f64,
    /// How often you win outright.
    pub win: f64,
    /// How often you tie for the best hand.
    pub tie: f64,
    /// Standard error of `equity`; `None` when enumerated exactly.
    pub std_err: Option<f64>,
    pub method: Method,
    /// Hand evaluations performed.
    pub evaluations: u64,
    /// Opponent combos left after removing those that use known cards
    /// (summed over opponents for multiway).
    pub live_combos: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EquityError {
    /// A card appears twice among hero, board and dead cards.
    DuplicateCards,
    /// The board must have 0, 3, 4 or 5 cards.
    BadBoard(usize),
    /// Every combo in a range uses a known card, or the ranges can't be dealt together.
    NoLiveCombos,
}

impl fmt::Display for EquityError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EquityError::DuplicateCards => {
                write!(f, "a card appears twice in hero, board and dead cards")
            }
            EquityError::BadBoard(n) => {
                write!(f, "the board must have 0, 3, 4 or 5 cards, not {n}")
            }
            EquityError::NoLiveCombos => {
                write!(f, "no opponent hands are possible with these cards")
            }
        }
    }
}

impl std::error::Error for EquityError {}

/// Hero's equity against one opponent's range.
pub fn equity(
    hero: [Card; 2],
    villain: &Range,
    board: &[Card],
    dead: CardMask,
    opts: &EquityOptions,
) -> Result<EquityResult, EquityError> {
    let spot = Spot::new(hero, board, dead)?;
    let live = spot.live_combos(villain);
    if live.is_empty() {
        return Err(EquityError::NoLiveCombos);
    }

    let unseen = 52 - spot.known.len() as u64; // cards hero can't see, before the villain's
    let runouts_per_combo = choose(unseen - 2, spot.cards_to_come);
    let work = live.len() as u64 * runouts_per_combo + choose(unseen, spot.cards_to_come);
    if work <= opts.exact_limit {
        Ok(spot.enumerate(&live))
    } else {
        spot.monte_carlo(&[live], opts)
    }
}

/// The most opponents `equity_multiway` accepts (a full 10-seat table).
pub const MAX_OPPONENTS: usize = 9;

/// Hero's equity against several opponents at once (up to [`MAX_OPPONENTS`]).
/// Always Monte Carlo. Panics if given more opponents than that.
pub fn equity_multiway(
    hero: [Card; 2],
    villains: &[Range],
    board: &[Card],
    dead: CardMask,
    opts: &EquityOptions,
) -> Result<EquityResult, EquityError> {
    assert!(
        villains.len() <= MAX_OPPONENTS,
        "at most {MAX_OPPONENTS} opponents"
    );
    let spot = Spot::new(hero, board, dead)?;
    let live: Vec<Vec<(CardMask, f32)>> = villains.iter().map(|v| spot.live_combos(v)).collect();
    if live.is_empty() || live.iter().any(Vec::is_empty) {
        return Err(EquityError::NoLiveCombos);
    }
    spot.monte_carlo(&live, opts)
}

/// The fixed parts of a calculation: hero's cards, the board, and every card
/// that can't appear in a runout or an opponent's hand.
struct Spot {
    hero: CardMask,
    board: CardMask,
    known: CardMask,
    cards_to_come: u64,
}

impl Spot {
    fn new(hero: [Card; 2], board: &[Card], dead: CardMask) -> Result<Spot, EquityError> {
        if ![0, 3, 4, 5].contains(&board.len()) {
            return Err(EquityError::BadBoard(board.len()));
        }
        let hero_mask: CardMask = hero.into_iter().collect();
        let board_mask: CardMask = board.iter().copied().collect();
        let known = hero_mask.union(board_mask).union(dead);
        if known.len() as usize != 2 + board.len() + dead.len() as usize {
            return Err(EquityError::DuplicateCards);
        }
        Ok(Spot {
            hero: hero_mask,
            board: board_mask,
            known,
            cards_to_come: 5 - board.len() as u64,
        })
    }

    /// The range's combos that don't use a known card, as (cards, weight).
    fn live_combos(&self, range: &Range) -> Vec<(CardMask, f32)> {
        range
            .combos()
            .map(|(i, _, w)| (combo_mask(i), w))
            .filter(|(m, _)| !m.intersects(self.known))
            .collect()
    }

    fn enumerate(&self, live: &[(CardMask, f32)]) -> EquityResult {
        let deck: Vec<Card> = CardMask::FULL_DECK
            .iter()
            .filter(|&c| !self.known.contains(c))
            .collect();
        let (mut win, mut tie, mut total) = (0.0f64, 0.0f64, 0.0f64);
        let mut evaluations = 0u64;

        for_each_subset(&deck, self.cards_to_come as usize, |runout| {
            let board = self.board.union(runout);
            let hero_rank = fast::eval_mask(self.hero.union(board));
            evaluations += 1;
            for &(combo, weight) in live {
                if combo.intersects(runout) {
                    continue;
                }
                let villain_rank = fast::eval_mask(combo.union(board));
                evaluations += 1;
                let w = weight as f64;
                total += w;
                if hero_rank > villain_rank {
                    win += w;
                } else if hero_rank == villain_rank {
                    tie += w;
                }
            }
        });

        EquityResult {
            equity: (win + tie / 2.0) / total,
            win: win / total,
            tie: tie / total,
            std_err: None,
            method: Method::Exact,
            evaluations,
            live_combos: live.len(),
        }
    }

    fn monte_carlo(
        &self,
        villains: &[Vec<(CardMask, f32)>],
        opts: &EquityOptions,
    ) -> Result<EquityResult, EquityError> {
        const MIN_SAMPLES: u64 = 1_000;
        const CHECK_EVERY: u64 = 256;

        let samplers: Vec<WeightedSampler> =
            villains.iter().map(|v| WeightedSampler::new(v)).collect();
        let mut rng = ChaCha8Rng::seed_from_u64(opts.seed);
        let start = Instant::now();

        let (mut n, mut rejected) = (0u64, 0u64);
        let (mut sum, mut sum_sq, mut wins, mut ties) = (0.0f64, 0.0f64, 0u64, 0u64);
        let mut evaluations = 0u64;

        loop {
            // Deal every opponent a combo by weight. If two collide, redeal them
            // all: rejecting the whole deal keeps the joint odds correct.
            let mut used = self.known;
            let mut hands = [CardMask::empty(); MAX_OPPONENTS];
            let mut collided = false;
            for (slot, sampler) in hands.iter_mut().zip(&samplers) {
                let combo = sampler.sample(&mut rng);
                if combo.intersects(used) {
                    collided = true;
                    break;
                }
                used = used.union(combo);
                *slot = combo;
            }
            if collided {
                rejected += 1;
                if rejected > 10_000 && rejected > 50 * n {
                    return Err(EquityError::NoLiveCombos);
                }
                continue;
            }

            let mut runout = CardMask::empty();
            while (runout.len() as u64) < self.cards_to_come {
                let card = Card::from_index((rng.next_u32() % 52) as u8);
                if !used.contains(card) && !runout.contains(card) {
                    runout.insert(card);
                }
            }

            let board = self.board.union(runout);
            let hero_rank = fast::eval_mask(self.hero.union(board));
            let mut best_villain = HandRank::default();
            let mut tied = 0u32;
            for hand in &hands[..samplers.len()] {
                let rank = fast::eval_mask(hand.union(board));
                if rank > best_villain {
                    best_villain = rank;
                    tied = u32::from(rank == hero_rank);
                } else if rank == best_villain && rank == hero_rank {
                    tied += 1;
                }
            }
            evaluations += 1 + samplers.len() as u64;

            let share = if hero_rank > best_villain {
                wins += 1;
                1.0
            } else if hero_rank == best_villain {
                ties += 1;
                1.0 / (tied as f64 + 1.0)
            } else {
                0.0
            };
            n += 1;
            sum += share;
            sum_sq += share * share;

            if n >= opts.max_samples {
                break;
            }
            if n >= MIN_SAMPLES && n.is_multiple_of(CHECK_EVERY) {
                let err = std_err(sum, sum_sq, n);
                let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
                if err <= opts.max_std_err || elapsed_ms >= opts.budget_ms {
                    break;
                }
            }
        }

        let nf = n as f64;
        Ok(EquityResult {
            equity: sum / nf,
            win: wins as f64 / nf,
            tie: ties as f64 / nf,
            std_err: Some(std_err(sum, sum_sq, n)),
            method: Method::MonteCarlo,
            evaluations,
            live_combos: villains.iter().map(Vec::len).sum(),
        })
    }
}

/// Standard error of a mean, from the running sum and sum of squares.
fn std_err(sum: f64, sum_sq: f64, n: u64) -> f64 {
    if n < 2 {
        return f64::INFINITY;
    }
    let nf = n as f64;
    let mean = sum / nf;
    let variance = ((sum_sq / nf - mean * mean) * nf / (nf - 1.0)).max(0.0);
    (variance / nf).sqrt()
}

/// Picks combos with probability proportional to their weight: a random point
/// in [0, total weight) lands in one combo's slice of the cumulative sums.
struct WeightedSampler {
    combos: Vec<CardMask>,
    cumulative: Vec<f64>,
}

impl WeightedSampler {
    fn new(live: &[(CardMask, f32)]) -> WeightedSampler {
        let mut total = 0.0;
        let cumulative = live
            .iter()
            .map(|&(_, w)| {
                total += w as f64;
                total
            })
            .collect();
        WeightedSampler {
            combos: live.iter().map(|&(m, _)| m).collect(),
            cumulative,
        }
    }

    fn sample(&self, rng: &mut impl Rng) -> CardMask {
        let total = *self.cumulative.last().expect("non-empty");
        let unit = (rng.next_u64() >> 11) as f64 / (1u64 << 53) as f64; // uniform in [0, 1)
        let point = unit * total;
        let i = self.cumulative.partition_point(|&c| c <= point);
        self.combos[i.min(self.combos.len() - 1)]
    }
}

/// n choose k.
fn choose(n: u64, k: u64) -> u64 {
    if k > n {
        return 0;
    }
    (0..k).fold(1, |acc, i| acc * (n - i) / (i + 1))
}

/// Calls `f` with every `k`-card subset of `cards`, as a mask.
fn for_each_subset(cards: &[Card], k: usize, mut f: impl FnMut(CardMask)) {
    let n = cards.len();
    if k > n {
        return;
    }
    // `idx` holds the positions of the chosen cards, always increasing.
    let mut idx: Vec<usize> = (0..k).collect();
    loop {
        f(idx.iter().map(|&i| cards[i]).collect());
        // Advance to the next combination: bump the rightmost index that can move.
        let Some(pos) = (0..k).rev().find(|&p| idx[p] < n - k + p) else {
            return;
        };
        idx[pos] += 1;
        for p in pos + 1..k {
            idx[p] = idx[p - 1] + 1;
        }
    }
}

/// Remembers recent results, keyed by hero cards, board, dead cards, range
/// and options. The math panel asks for the same spot repeatedly as the user
/// moves the bet slider, so this makes repeat requests instant.
pub struct EquityCache {
    results: HashMap<CacheKey, EquityResult>,
    order: VecDeque<CacheKey>,
    capacity: usize,
    hits: u64,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct CacheKey {
    hero: u64,
    board: u64,
    dead: u64,
    range: u64,
    options: [u64; 5],
}

impl EquityCache {
    pub fn new(capacity: usize) -> EquityCache {
        EquityCache {
            results: HashMap::new(),
            order: VecDeque::new(),
            capacity: capacity.max(1),
            hits: 0,
        }
    }

    /// Same as [`equity`], but returns a stored result when the exact same
    /// request was made before. When full, the oldest entry is dropped.
    pub fn equity(
        &mut self,
        hero: [Card; 2],
        villain: &Range,
        board: &[Card],
        dead: CardMask,
        opts: &EquityOptions,
    ) -> Result<EquityResult, EquityError> {
        let key = CacheKey {
            hero: hero.into_iter().collect::<CardMask>().bits(),
            board: board.iter().copied().collect::<CardMask>().bits(),
            dead: dead.bits(),
            range: villain.fingerprint(),
            options: [
                opts.budget_ms.to_bits(),
                opts.max_std_err.to_bits(),
                opts.exact_limit,
                opts.max_samples,
                opts.seed,
            ],
        };
        if let Some(&result) = self.results.get(&key) {
            self.hits += 1;
            return Ok(result);
        }
        let result = equity(hero, villain, board, dead, opts)?;
        if self.results.len() >= self.capacity
            && let Some(oldest) = self.order.pop_front()
        {
            self.results.remove(&oldest);
        }
        self.results.insert(key, result);
        self.order.push_back(key);
        Ok(result)
    }

    /// How many requests were answered from the cache.
    pub fn hits(&self) -> u64 {
        self.hits
    }

    pub fn len(&self) -> usize {
        self.results.len()
    }

    pub fn is_empty(&self) -> bool {
        self.results.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cards(s: &str) -> Vec<Card> {
        s.split_whitespace().map(|c| c.parse().unwrap()).collect()
    }

    fn hand(s: &str) -> [Card; 2] {
        cards(s).try_into().unwrap()
    }

    fn range(s: &str) -> Range {
        Range::parse(s).unwrap()
    }

    fn exact(hero: &str, villain: &str, board: &str) -> EquityResult {
        equity(
            hand(hero),
            &range(villain),
            &cards(board),
            CardMask::empty(),
            &EquityOptions::default(),
        )
        .unwrap()
    }

    #[test]
    fn river_hand_vs_hand_is_win_lose_or_tie() {
        assert_eq!(exact("As Ad", "KsKd", "2c 7d 9h 4s 3c").equity, 1.0);
        assert_eq!(exact("Ks Kd", "AsAd", "2c 7d 9h 4s 3c").equity, 0.0);
        let chop = exact("2c 3d", "4h5h", "As Ks Qs Js Ts");
        assert_eq!((chop.equity, chop.win, chop.tie), (0.5, 0.0, 1.0));
    }

    #[test]
    fn turn_flush_draw_vs_set_counts_clean_outs() {
        // Hero's nut flush draw against a set of nines, one card to come.
        // 9 hearts are left, but Jh and 2h pair the board and give the set a
        // full house, so hero wins on 7 of the 44 unseen river cards.
        let r = exact("Ah Kh", "9s9d", "9h 5h 2c Jd");
        assert_eq!(r.method, Method::Exact);
        assert!((r.equity - 7.0 / 44.0).abs() < 1e-9, "got {}", r.equity);
    }

    #[test]
    fn ties_count_as_half_and_weights_matter() {
        // On this board, AK chops with AK and beats KQ.
        let board = "Ac Kd 7h 4s 2c";
        let vs_ak = exact("As Ks", "AhKh", board);
        assert_eq!(vs_ak.equity, 0.5);
        let vs_mixed = exact("As Ks", "AhKh, 0.5(KhQh)", board);
        // Weight 1 at a chop (0.5) and weight 0.5 at a win (1.0): (0.5 + 0.5) / 1.5.
        assert!((vs_mixed.equity - 1.0 / 1.5).abs() < 1e-9);
    }

    #[test]
    fn blocked_combos_are_ignored() {
        // Hero holds the ace of spades, so AsKs isn't a possible villain hand.
        let r = exact("As Qd", "AsKs, KhKd", "2c 7d 9h 4s 3c");
        assert_eq!(r.live_combos, 1);
        assert_eq!(r.equity, 0.0);
    }

    #[test]
    fn dead_cards_are_removed_from_range_and_runouts() {
        let opts = EquityOptions::default();
        // With Kh and Kd dead, KcKs is the only kings combo left.
        let dead: CardMask = cards("Kh Kd").into_iter().collect();
        let r = equity(
            hand("As Ad"),
            &range("KK"),
            &cards("2c 7d 9h 4s 3c"),
            dead,
            &opts,
        )
        .unwrap();
        assert_eq!(r.live_combos, 1);

        // Queens vs aces on the turn: 2 queens left among 44 unseen cards.
        let board = cards("2c 7d 9h 4s");
        let live = equity(
            hand("Qs Qh"),
            &range("AsAh"),
            &board,
            CardMask::empty(),
            &opts,
        )
        .unwrap();
        assert!((live.equity - 2.0 / 44.0).abs() < 1e-9);
        // With the Qc dead, 1 queen among 43.
        let dead: CardMask = cards("Qc").into_iter().collect();
        let one_out = equity(hand("Qs Qh"), &range("AsAh"), &board, dead, &opts).unwrap();
        assert!((one_out.equity - 1.0 / 43.0).abs() < 1e-9);
    }

    #[test]
    fn rejects_bad_input() {
        let opts = EquityOptions::default();
        let none = CardMask::empty();
        assert_eq!(
            equity(hand("As Ad"), &range("KK"), &cards("As 7d 9h"), none, &opts),
            Err(EquityError::DuplicateCards)
        );
        assert_eq!(
            equity(hand("As Ad"), &range("KK"), &cards("2c 7d"), none, &opts),
            Err(EquityError::BadBoard(2))
        );
        assert_eq!(
            equity(
                hand("As Ad"),
                &range("AhAc"),
                &cards("Ah 7d 9h"),
                none,
                &opts
            ),
            Err(EquityError::NoLiveCombos)
        );
        assert_eq!(
            equity(hand("As Ad"), &Range::empty(), &[], none, &opts),
            Err(EquityError::NoLiveCombos)
        );
    }

    #[test]
    fn small_spots_enumerate_and_big_ones_sample() {
        let flop = exact("As Kd", "22+, A2s+, KTo+", "Ts 9h 2c");
        assert_eq!(flop.method, Method::Exact);
        assert_eq!(flop.std_err, None);

        let preflop = exact("As Kd", "22+, A2s+, KTo+", "");
        assert_eq!(preflop.method, Method::MonteCarlo);
        assert!(preflop.std_err.is_some());
    }

    #[test]
    fn monte_carlo_agrees_with_exact() {
        let (hero, villain, board) = (
            hand("Ah Kh"),
            range("QQ+, AQs+, 0.5(JJ, TT)"),
            cards("Qh 7h 2c"),
        );
        let exact = equity(
            hero,
            &villain,
            &board,
            CardMask::empty(),
            &EquityOptions::default(),
        )
        .unwrap();
        let opts = EquityOptions {
            exact_limit: 0,
            max_std_err: 0.0,
            max_samples: 200_000,
            budget_ms: f64::INFINITY,
            seed: 7,
        };
        let mc = equity(hero, &villain, &board, CardMask::empty(), &opts).unwrap();
        assert_eq!(mc.method, Method::MonteCarlo);
        let err = mc.std_err.unwrap();
        assert!(
            (mc.equity - exact.equity).abs() < 4.0 * err,
            "mc {} vs exact {} (se {err})",
            mc.equity,
            exact.equity
        );
    }

    #[test]
    fn monte_carlo_is_reproducible_for_a_seed() {
        let opts = EquityOptions {
            exact_limit: 0,
            max_samples: 5_000,
            max_std_err: 0.0,
            budget_ms: f64::INFINITY,
            seed: 3,
        };
        let run = || equity(hand("As Kd"), &range("TT+"), &[], CardMask::empty(), &opts).unwrap();
        assert_eq!(run(), run());
    }

    #[test]
    fn known_preflop_matchups() {
        // Well-known all-in equities: AA vs KK ~81.9%, AKs vs QQ ~46%.
        let opts = EquityOptions {
            max_std_err: 0.002,
            budget_ms: f64::INFINITY,
            ..EquityOptions::default()
        };
        let aa = equity(hand("As Ah"), &range("KsKd"), &[], CardMask::empty(), &opts).unwrap();
        assert!((aa.equity - 0.819).abs() < 0.01, "AA vs KK: {}", aa.equity);
        let aks = equity(hand("As Ks"), &range("QhQd"), &[], CardMask::empty(), &opts).unwrap();
        assert!(
            (aks.equity - 0.46).abs() < 0.015,
            "AKs vs QQ: {}",
            aks.equity
        );
    }

    #[test]
    fn multiway_shares_ties_three_ways() {
        // Royal flush on board: everyone chops.
        let villains = [range("2c3c"), range("4d5d")];
        let r = equity_multiway(
            hand("6h 7h"),
            &villains,
            &cards("As Ks Qs Js Ts"),
            CardMask::empty(),
            &EquityOptions::default(),
        )
        .unwrap();
        assert!((r.equity - 1.0 / 3.0).abs() < 1e-9);
        assert_eq!(r.tie, 1.0);
    }

    #[test]
    fn multiway_rejects_ranges_that_cant_be_dealt_together() {
        let villains = [range("KsKd"), range("KsKd")];
        let r = equity_multiway(
            hand("As Ah"),
            &villains,
            &[],
            CardMask::empty(),
            &EquityOptions::default(),
        );
        assert_eq!(r, Err(EquityError::NoLiveCombos));
    }

    #[test]
    fn cache_returns_stored_results() {
        let mut cache = EquityCache::new(2);
        let opts = EquityOptions::default();
        let none = CardMask::empty();
        let ask = |cache: &mut EquityCache, villain: &str| {
            cache
                .equity(
                    hand("As Kd"),
                    &range(villain),
                    &cards("Ts 9h 2c"),
                    none,
                    &opts,
                )
                .unwrap()
        };
        let first = ask(&mut cache, "TT+");
        assert_eq!(ask(&mut cache, "TT+"), first);
        assert_eq!(cache.hits(), 1);
        ask(&mut cache, "JJ+");
        ask(&mut cache, "QQ+"); // evicts TT+
        assert_eq!(cache.len(), 2);
        ask(&mut cache, "TT+");
        assert_eq!(cache.hits(), 1);
    }

    #[test]
    fn subsets_and_choose_agree() {
        let deck: Vec<Card> = Card::all().take(10).collect();
        for k in 0..=5 {
            let mut count = 0;
            for_each_subset(&deck, k, |m| {
                assert_eq!(m.len() as usize, k);
                count += 1;
            });
            assert_eq!(count, choose(10, k as u64), "k = {k}");
        }
        assert_eq!(choose(45, 2), 990);
        assert_eq!(choose(48, 5), 1_712_304);
    }
}
