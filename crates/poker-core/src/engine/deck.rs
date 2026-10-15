use rand_chacha::ChaCha20Rng;
use rand_chacha::rand_core::{Rng, SeedableRng};

use crate::card::Card;
use crate::mask::CardMask;

/// A full 52-card deck in a fixed order. Cards are dealt from the top (index 0) down.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Deck {
    cards: [Card; 52],
}

impl Deck {
    /// A deck shuffled with Fisher–Yates, driven by a ChaCha20 generator seeded
    /// with `seed`. The same seed always gives the same order, on every
    /// platform and build, which is what lets a saved hand be replayed exactly.
    pub fn shuffled(seed: u64) -> Deck {
        let mut cards: [Card; 52] = std::array::from_fn(|i| Card::from_index(i as u8));
        let mut rng = ChaCha20Rng::seed_from_u64(seed);
        // Walk from the end; swap each position with a random one at or before it.
        for i in (1..52).rev() {
            let j = uniform_below(&mut rng, i as u32 + 1) as usize;
            cards.swap(i, j);
        }
        Deck { cards }
    }

    /// A deck with `top` dealt first, then every other card in index order.
    /// Used to set up specific spots (tests, drills). Panics on duplicate cards.
    pub fn stacked(top: &[Card]) -> Deck {
        let mut seen = CardMask::empty();
        let mut cards = Vec::with_capacity(52);
        for &card in top {
            assert!(
                !seen.contains(card),
                "duplicate card {card} in stacked deck"
            );
            seen.insert(card);
            cards.push(card);
        }
        cards.extend(Card::all().filter(|&c| !seen.contains(c)));
        Deck {
            cards: cards.try_into().expect("exactly 52 cards"),
        }
    }

    /// The card at position `i` from the top.
    pub fn card(&self, i: usize) -> Card {
        self.cards[i]
    }
}

/// A uniformly random integer in `0..n`.
///
/// Plain `x % n` is slightly biased: 2^32 isn't a multiple of n, so the
/// smallest results would come up a little more often. Rejecting draws from
/// the incomplete top band removes the bias.
fn uniform_below(rng: &mut impl Rng, n: u32) -> u32 {
    let range = 1u64 << 32;
    let limit = range - range % n as u64;
    loop {
        let x = rng.next_u32() as u64;
        if x < limit {
            return (x % n as u64) as u32;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_seed_same_deck() {
        assert_eq!(Deck::shuffled(42), Deck::shuffled(42));
        assert_ne!(Deck::shuffled(42), Deck::shuffled(43));
    }

    #[test]
    fn shuffled_deck_is_a_permutation() {
        let deck = Deck::shuffled(7);
        let all: CardMask = (0..52).map(|i| deck.card(i)).collect();
        assert_eq!(all, CardMask::FULL_DECK);
    }

    /// Pins the exact output for one seed. If this fails, the shuffle changed,
    /// and every saved hand history would replay with different cards.
    #[test]
    fn shuffle_output_is_stable() {
        let deck = Deck::shuffled(0);
        let top: Vec<String> = (0..5).map(|i| deck.card(i).to_string()).collect();
        assert_eq!(top, PINNED_SEED_0_TOP5);
    }

    const PINNED_SEED_0_TOP5: [&str; 5] = ["5h", "Kc", "Kh", "8h", "9s"];

    #[test]
    fn every_card_reaches_the_top_about_equally_often() {
        // 52,000 shuffles: each card should be on top ~1,000 times.
        let mut counts = [0u32; 52];
        for seed in 0..52_000 {
            counts[Deck::shuffled(seed).card(0).index() as usize] += 1;
        }
        for (card, &count) in counts.iter().enumerate() {
            assert!(
                (850..1150).contains(&count),
                "card {card} on top {count} times"
            );
        }
    }

    #[test]
    fn stacked_deck_deals_given_cards_first() {
        let top: Vec<Card> = ["As", "Kd", "2c"]
            .iter()
            .map(|s| s.parse().unwrap())
            .collect();
        let deck = Deck::stacked(&top);
        assert_eq!(deck.card(0), top[0]);
        assert_eq!(deck.card(2), top[2]);
        let all: CardMask = (0..52).map(|i| deck.card(i)).collect();
        assert_eq!(all, CardMask::FULL_DECK);
    }

    #[test]
    #[should_panic]
    fn stacked_deck_rejects_duplicates() {
        let ace: Card = "As".parse().unwrap();
        Deck::stacked(&[ace, ace]);
    }
}
