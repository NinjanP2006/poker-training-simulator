//! Fast hand evaluator: one pass over the cards, then a single table lookup.
//!
//! **Flushes.** With 5–7 cards at most one suit can hold five or more. When one
//! does, the best hand is a flush or a straight flush in that suit: a full
//! house or quads would need repeated ranks that a 7-card hand containing a
//! five-card flush can't also have. So a flush hand is fully described by the
//! 13-bit mask of that suit's ranks, which indexes `flush` directly.
//!
//! **Everything else** depends only on how many cards of each rank there are,
//! not on suits. Those rank-count vectors (13 counts, each 0–4, summing to n)
//! are numbered 0..N by their position in lexicographic order. That numbering
//! is a minimal perfect hash: no gaps, no collisions, and N is only 49,205 for
//! seven cards. It indexes `by_len[n - 5]`.
//!
//! The tables are filled once, on first use, by running the naive evaluator on
//! every flush mask and every rank-count vector. Every stored value therefore
//! comes from the verified reference; what the tests check is the indexing.

use std::sync::OnceLock;

use super::{HandRank, naive};
use crate::card::Card;
use crate::mask::CardMask;

const RANKS: usize = 13;
const MAX_CARDS: usize = 7;
const MAX_PER_RANK: usize = 4;

struct Tables {
    /// Best hand for a suit's 13-bit rank mask. Only masks with 5–7 bits are filled.
    flush: Vec<HandRank>,
    /// `prefix[r][k][c]`: how many rank-count vectors sort before one that has
    /// `c` cards at rank `r`, given `k` cards left to place in ranks `r..13`.
    prefix: [[[u32; MAX_PER_RANK + 1]; MAX_CARDS + 1]; RANKS],
    /// Non-flush hand values for 5, 6 and 7 cards, indexed by `hash`.
    by_len: [Vec<HandRank>; 3],
}

static TABLES: OnceLock<Tables> = OnceLock::new();

fn tables() -> &'static Tables {
    TABLES.get_or_init(Tables::build)
}

/// Builds the lookup tables now instead of on the first evaluation. Call this
/// at startup (e.g. when the Web Worker loads) so the first equity request
/// isn't slowed by table generation.
pub fn init() {
    tables();
}

/// Scores 5, 6 or 7 cards given as a mask. Panics on any other count.
pub fn eval_mask(cards: CardMask) -> HandRank {
    let n = cards.len() as usize;
    assert!(
        (5..=MAX_CARDS).contains(&n),
        "eval needs 5-7 cards, got {n}"
    );
    let t = tables();

    let mut counts = [0u8; RANKS];
    let mut suit_ranks = [0u16; 4]; // per suit: bit r set if that suit has rank r
    for card in cards {
        counts[card.rank() as usize] += 1;
        suit_ranks[card.suit() as usize] |= 1 << card.rank();
    }

    for ranks in suit_ranks {
        if ranks.count_ones() >= 5 {
            return t.flush[ranks as usize];
        }
    }
    t.by_len[n - 5][t.hash(&counts, n)]
}

/// Scores 5, 6 or 7 distinct cards. Panics on any other count or on duplicates.
pub fn eval(cards: &[Card]) -> HandRank {
    let mask: CardMask = cards.iter().copied().collect();
    assert_eq!(
        mask.len() as usize,
        cards.len(),
        "duplicate cards in {cards:?}"
    );
    eval_mask(mask)
}

impl Tables {
    fn build() -> Tables {
        let ways = ways();

        let mut prefix = [[[0u32; MAX_PER_RANK + 1]; MAX_CARDS + 1]; RANKS];
        for (r, by_left) in prefix.iter_mut().enumerate() {
            let ranks_after = RANKS - 1 - r;
            for (left, by_count) in by_left.iter_mut().enumerate() {
                for c in 1..=MAX_PER_RANK {
                    // Add the vectors with exactly c - 1 cards here and the rest in later ranks.
                    let j = c - 1;
                    let with_j = if j <= left {
                        ways[ranks_after][left - j]
                    } else {
                        0
                    };
                    by_count[c] = by_count[c - 1] + with_j;
                }
            }
        }

        let mut tables = Tables {
            flush: vec![HandRank::from_value(0); 1 << RANKS],
            prefix,
            by_len: Default::default(),
        };

        for ranks in 0u16..1 << RANKS {
            if (5..=MAX_CARDS as u32).contains(&ranks.count_ones()) {
                let cards: Vec<Card> = (0..RANKS as u8)
                    .filter(|&r| ranks & (1 << r) != 0)
                    .map(|r| Card::new(r, 0))
                    .collect();
                tables.flush[ranks as usize] = naive::eval(&cards);
            }
        }

        for n in 5..=MAX_CARDS {
            let mut table = vec![HandRank::from_value(0); ways[RANKS][n] as usize];
            for_each_count_vector(n, &mut |counts| {
                table[tables.hash(counts, n)] = naive::eval(&cards_without_flush(counts));
            });
            tables.by_len[n - 5] = table;
        }

        tables
    }

    /// Position of a rank-count vector among all vectors with the same total `n`.
    fn hash(&self, counts: &[u8; RANKS], n: usize) -> usize {
        let mut left = n;
        let mut index = 0;
        for (r, &c) in counts.iter().enumerate() {
            index += self.prefix[r][left][c as usize];
            left -= c as usize;
        }
        index as usize
    }
}

/// `ways[i][k]`: how many ways to place `k` cards into `i` ranks, at most 4 per rank.
fn ways() -> [[u32; MAX_CARDS + 1]; RANKS + 1] {
    let mut ways = [[0u32; MAX_CARDS + 1]; RANKS + 1];
    ways[0][0] = 1;
    for i in 1..=RANKS {
        for k in 0..=MAX_CARDS {
            ways[i][k] = (0..=k.min(MAX_PER_RANK)).map(|c| ways[i - 1][k - c]).sum();
        }
    }
    ways
}

/// Calls `f` with every rank-count vector (each count 0–4) that sums to `n`.
fn for_each_count_vector(n: usize, f: &mut impl FnMut(&[u8; RANKS])) {
    fn place(r: usize, left: usize, counts: &mut [u8; RANKS], f: &mut impl FnMut(&[u8; RANKS])) {
        if r == RANKS {
            if left == 0 {
                f(counts);
            }
            return;
        }
        for c in 0..=left.min(MAX_PER_RANK) {
            counts[r] = c as u8;
            place(r + 1, left - c, counts, f);
        }
        counts[r] = 0;
    }
    place(0, n, &mut [0; RANKS], f);
}

/// Real cards with the given rank counts and no flush. Suits cycle 0,1,2,3,0,…
/// across all cards, so copies of one rank (always consecutive, at most 4) get
/// different suits, and 7 cards put at most 2 in any suit.
fn cards_without_flush(counts: &[u8; RANKS]) -> Vec<Card> {
    let mut cards = Vec::with_capacity(MAX_CARDS);
    for (r, &c) in counts.iter().enumerate() {
        for _ in 0..c {
            cards.push(Card::new(r as u8, (cards.len() % 4) as u8));
        }
    }
    cards
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::eval::Category;
    use std::collections::HashSet;

    /// Small deterministic random-number generator (xorshift64), so test
    /// failures are reproducible without pulling in a dependency.
    struct Rng(u64);

    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            self.0
        }

        fn hand(&mut self, n: usize) -> Vec<Card> {
            let mut seen = CardMask::empty();
            let mut cards = Vec::with_capacity(n);
            while cards.len() < n {
                let card = Card::from_index((self.next() % 52) as u8);
                if !seen.contains(card) {
                    seen.insert(card);
                    cards.push(card);
                }
            }
            cards
        }
    }

    fn assert_matches_naive_on_random_hands(n: usize, count: usize, seed: u64) {
        let mut rng = Rng(seed);
        for _ in 0..count {
            let hand = rng.hand(n);
            assert_eq!(eval(&hand), naive::eval(&hand), "mismatch on {hand:?}");
        }
    }

    #[test]
    fn hash_numbers_every_rank_count_vector_without_gaps() {
        let t = tables();
        for n in 5..=MAX_CARDS {
            let size = t.by_len[n - 5].len();
            let mut seen = vec![false; size];
            for_each_count_vector(n, &mut |counts| {
                let i = t.hash(counts, n);
                assert!(!seen[i], "hash collision at {i} for {counts:?}");
                seen[i] = true;
            });
            assert!(seen.iter().all(|&s| s), "gap in hash range for n = {n}");
        }
    }

    #[test]
    fn table_sizes() {
        let t = tables();
        assert_eq!(t.by_len[0].len(), 6_175);
        assert_eq!(t.by_len[1].len(), 18_395);
        assert_eq!(t.by_len[2].len(), 49_205);
    }

    #[test]
    fn generated_hands_never_contain_a_flush() {
        for n in 5..=MAX_CARDS {
            for_each_count_vector(n, &mut |counts| {
                let cards = cards_without_flush(counts);
                let mut per_suit = [0; 4];
                for card in &cards {
                    per_suit[card.suit() as usize] += 1;
                }
                assert!(per_suit.iter().all(|&k| k < 5), "{cards:?}");
            });
        }
    }

    #[test]
    fn matches_naive_on_every_five_card_hand() {
        let card = Card::from_index;
        for a in 0..52 {
            for b in a + 1..52 {
                for c in b + 1..52 {
                    for d in c + 1..52 {
                        for e in d + 1..52 {
                            let five = [card(a), card(b), card(c), card(d), card(e)];
                            assert_eq!(eval(&five), naive::eval5(five), "{five:?}");
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn matches_naive_on_random_six_and_seven_card_hands() {
        assert_matches_naive_on_random_hands(6, 20_000, 0x1234_5678_9ABC_DEF0);
        assert_matches_naive_on_random_hands(7, 20_000, 0x0FED_CBA9_8765_4321);
    }

    #[test]
    fn flush_beats_board_straight_and_straight_flush_wins() {
        let cards =
            |s: &str| -> Vec<Card> { s.split_whitespace().map(|c| c.parse().unwrap()).collect() };
        assert_eq!(
            eval(&cards("Ah Kh 9h 8h 7c 6d 5h")).category(),
            Category::Flush
        );
        assert_eq!(
            eval(&cards("9h 8h 7h 6h 5h Ah Ad")).category(),
            Category::StraightFlush
        );
        assert_eq!(
            eval(&cards("As 2s 3s 4s 5s Kd Kc")).category(),
            Category::StraightFlush
        );
    }

    #[test]
    #[should_panic]
    fn rejects_too_few_cards() {
        eval_mask(CardMask::FULL_DECK.iter().take(4).collect());
    }

    // Slow in debug builds. CI runs these with `cargo test --release -- --ignored`.

    #[test]
    #[ignore]
    fn matches_naive_on_a_million_random_seven_card_hands() {
        assert_matches_naive_on_random_hands(7, 1_000_000, 0xDEAD_BEEF_CAFE_F00D);
    }

    /// Scores all 133,784,560 seven-card hands and checks the category counts
    /// against the known totals, plus the number of distinct hand values.
    #[test]
    #[ignore]
    fn exhaustive_seven_card_counts() {
        let mut counts = [0u64; 9];
        let mut distinct = HashSet::new();
        let bit = |i: u8| -> CardMask { [Card::from_index(i)].into_iter().collect() };
        for a in 0..52 {
            let ma = bit(a);
            for b in a + 1..52 {
                let mb = ma.union(bit(b));
                for c in b + 1..52 {
                    let mc = mb.union(bit(c));
                    for d in c + 1..52 {
                        let md = mc.union(bit(d));
                        for e in d + 1..52 {
                            let me = md.union(bit(e));
                            for f in e + 1..52 {
                                let mf = me.union(bit(f));
                                for g in f + 1..52 {
                                    let r = eval_mask(mf.union(bit(g)));
                                    counts[r.category() as usize] += 1;
                                    distinct.insert(r);
                                }
                            }
                        }
                    }
                }
            }
        }
        assert_eq!(
            counts,
            [
                23_294_460, 58_627_800, 31_433_400, 6_461_620, 6_180_020, 4_047_644, 3_473_184,
                224_848, 41_584
            ]
        );
        assert_eq!(counts.iter().sum::<u64>(), 133_784_560);
        // Only 4,824 of the 7,462 five-card strengths can be the best hand of seven.
        assert_eq!(distinct.len(), 4_824);
    }
}
