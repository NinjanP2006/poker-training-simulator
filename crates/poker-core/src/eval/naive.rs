//! A simple, readable hand evaluator. Slow (a 7-card hand scores all 21
//! five-card subsets) but easy to verify, so it serves as the reference.

use std::cmp::Reverse;

use super::{Category, HandRank};
use crate::card::Card;
use crate::mask::CardMask;

/// Rank bits for A-5-4-3-2, the one straight where the ace plays low.
const WHEEL: u16 = 0b1_0000_0000_1111;

/// Scores exactly five cards.
pub fn eval5(cards: [Card; 5]) -> HandRank {
    let mut counts = [0u8; 13];
    let mut rank_bits = 0u16; // bit r set if any card has rank r
    for card in cards {
        counts[card.rank() as usize] += 1;
        rank_bits |= 1 << card.rank();
    }
    let flush = cards.iter().all(|c| c.suit() == cards[0].suit());
    let straight_high = straight_high(rank_bits);

    // Group ranks as (count, rank): biggest group first, and within the same
    // count, highest rank first. For KKK22 this gives [(3, K), (2, 2)].
    let mut groups = [(0u8, 0u8); 5];
    let mut n = 0;
    for rank in (0..13u8).rev() {
        let count = counts[rank as usize];
        if count > 0 {
            groups[n] = (count, rank);
            n += 1;
        }
    }
    let groups = &mut groups[..n];
    groups.sort_by_key(|&(count, _)| Reverse(count)); // stable, so equal counts keep high-rank-first order

    // The ranks in order of importance, used to break ties within a category.
    let mut ranks = [0u8; 5];
    for (slot, &(_, rank)) in ranks.iter_mut().zip(groups.iter()) {
        *slot = rank;
    }
    let ranks = &ranks[..n];

    if let (true, Some(high)) = (flush, straight_high) {
        return HandRank::new(Category::StraightFlush, &[high]);
    }
    // Five cards always form at least two rank groups, so groups[1] exists.
    match (groups[0].0, groups[1].0) {
        (4, _) => HandRank::new(Category::Quads, ranks),
        (3, 2) => HandRank::new(Category::FullHouse, ranks),
        _ if flush => HandRank::new(Category::Flush, ranks),
        _ if straight_high.is_some() => {
            HandRank::new(Category::Straight, &[straight_high.unwrap()])
        }
        (3, _) => HandRank::new(Category::Trips, ranks),
        (2, 2) => HandRank::new(Category::TwoPair, ranks),
        (2, _) => HandRank::new(Category::Pair, ranks),
        _ => HandRank::new(Category::HighCard, ranks),
    }
}

/// If the five distinct ranks in `rank_bits` form a straight, returns its top rank.
/// The wheel (A-2-3-4-5) counts as five-high.
fn straight_high(rank_bits: u16) -> Option<u8> {
    if rank_bits.count_ones() != 5 {
        return None;
    }
    let low = rank_bits.trailing_zeros();
    if rank_bits >> low == 0b11111 {
        Some(low as u8 + 4)
    } else if rank_bits == WHEEL {
        Some(3) // rank 3 = five
    } else {
        None
    }
}

/// Scores 5, 6 or 7 distinct cards: the best five-card hand among them.
/// Panics on any other count or on duplicate cards.
pub fn eval(cards: &[Card]) -> HandRank {
    let n = cards.len();
    assert!((5..=7).contains(&n), "eval needs 5-7 cards, got {n}");
    let distinct: CardMask = cards.iter().copied().collect();
    assert_eq!(distinct.len() as usize, n, "duplicate cards in {cards:?}");

    // Each n-bit number with exactly five bits set picks one five-card subset.
    (0u32..1 << n)
        .filter(|pick| pick.count_ones() == 5)
        .map(|pick| {
            let mut five = [cards[0]; 5];
            let chosen = cards.iter().enumerate().filter(|(j, _)| pick >> j & 1 == 1);
            for (slot, (_, &card)) in five.iter_mut().zip(chosen) {
                *slot = card;
            }
            eval5(five)
        })
        .max()
        .expect("at least one five-card subset")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn cards(s: &str) -> Vec<Card> {
        s.split_whitespace().map(|c| c.parse().unwrap()).collect()
    }

    fn rank(s: &str) -> HandRank {
        eval(&cards(s))
    }

    #[test]
    fn recognizes_every_category() {
        let cases = [
            ("As Kd 9h 7c 3s", Category::HighCard),
            ("As Ad 9h 7c 3s", Category::Pair),
            ("As Ad 9h 9c 3s", Category::TwoPair),
            ("As Ad Ah 7c 3s", Category::Trips),
            ("9s 8d 7h 6c 5s", Category::Straight),
            ("As Ks 9s 7s 3s", Category::Flush),
            ("As Ad Ah 3c 3s", Category::FullHouse),
            ("As Ad Ah Ac 3s", Category::Quads),
            ("9s 8s 7s 6s 5s", Category::StraightFlush),
        ];
        for (hand, expected) in cases {
            assert_eq!(rank(hand).category(), expected, "{hand}");
        }
    }

    #[test]
    fn wheel_is_the_lowest_straight() {
        let wheel = rank("As 2d 3h 4c 5s");
        let six_high = rank("2d 3h 4c 5s 6s");
        assert_eq!(wheel.category(), Category::Straight);
        assert!(six_high > wheel);
        assert!(rank("As Kd Qh Jc Ts") > rank("Ks Qd Jh Tc 9s"));
    }

    #[test]
    fn steel_wheel_is_the_lowest_straight_flush() {
        let steel_wheel = rank("As 2s 3s 4s 5s");
        assert_eq!(steel_wheel.category(), Category::StraightFlush);
        assert!(rank("2s 3s 4s 5s 6s") > steel_wheel);
    }

    #[test]
    fn no_wraparound_straight() {
        // Q-K-A-2-3 is not a straight.
        assert_eq!(rank("Qs Kd Ah 2c 3s").category(), Category::HighCard);
    }

    #[test]
    fn ties_break_in_order_of_importance() {
        // Full house: trips decide before the pair.
        assert!(rank("Ks Kd Kh 2c 2s") > rank("Qs Qd Qh Ac As"));
        // Two pair: high pair, then low pair, then kicker.
        assert!(rank("As Ad 3h 3c 2s") > rank("Ks Kd Qh Qc As"));
        assert!(rank("As Ad 9h 9c Ks") > rank("Ah Ac 9s 9d Qs"));
        // Pair: kickers in order.
        assert!(rank("As Ad Kh 7c 3s") > rank("Ah Ac Qs Jd Ts"));
        // Flush: compares every card, top down.
        assert!(rank("As Ks 9s 7s 4s") > rank("Ah Kh 9h 7h 3h"));
    }

    #[test]
    fn same_hand_in_different_suits_ties() {
        assert_eq!(rank("As Kd 9h 7c 3s"), rank("Ah Kc 9d 7s 3h"));
    }

    #[test]
    fn seven_cards_pick_the_best_five() {
        // Board makes a straight; hole cards add a flush.
        let hand = rank("Ah Kh 9h 8h 7c 6d 5h");
        assert_eq!(hand.category(), Category::Flush);
        // Board plays: both players have the same broadway straight.
        assert_eq!(rank("2c 3d As Kd Qh Jc Ts"), rank("4c 4d As Kd Qh Jc Ts"));
        // Six cards work too.
        assert_eq!(rank("As Ad Ah Kc Ks 2d").category(), Category::FullHouse);
    }

    #[test]
    #[should_panic]
    fn rejects_duplicate_cards() {
        rank("As As Kd Qh Jc");
    }

    /// Scores all 2,598,960 five-card hands and checks the category counts
    /// against the known totals, plus the number of distinct hand values.
    #[test]
    fn exhaustive_five_card_counts() {
        let mut counts = [0u32; 9];
        let mut distinct = HashSet::new();
        let card = Card::from_index;
        for a in 0..52 {
            for b in a + 1..52 {
                for c in b + 1..52 {
                    for d in c + 1..52 {
                        for e in d + 1..52 {
                            let r = eval5([card(a), card(b), card(c), card(d), card(e)]);
                            counts[r.category() as usize] += 1;
                            distinct.insert(r);
                        }
                    }
                }
            }
        }
        assert_eq!(
            counts,
            [
                1_302_540, 1_098_240, 123_552, 54_912, 10_200, 5_108, 3_744, 624, 40
            ]
        );
        assert_eq!(counts.iter().sum::<u32>(), 2_598_960);
        // There are exactly 7,462 distinct five-card hand strengths.
        assert_eq!(distinct.len(), 7_462);
    }
}
