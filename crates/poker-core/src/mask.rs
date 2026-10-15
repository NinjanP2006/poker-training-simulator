use crate::card::Card;

/// A set of cards stored as a 64-bit bitmask: bit `c` is set when card `c` is in the set.
///
/// Every set operation is a single CPU instruction, which matters because the
/// equity engine checks for card conflicts millions of times per calculation.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
pub struct CardMask(u64);

const fn bit(card: Card) -> u64 {
    1u64 << card.index()
}

impl CardMask {
    /// All 52 cards: the low 52 bits set.
    pub const FULL_DECK: CardMask = CardMask((1u64 << 52) - 1);

    pub const fn empty() -> CardMask {
        CardMask(0)
    }

    /// The raw bits, e.g. for passing across the WASM boundary.
    pub const fn bits(self) -> u64 {
        self.0
    }

    pub fn insert(&mut self, card: Card) {
        self.0 |= bit(card);
    }

    pub fn remove(&mut self, card: Card) {
        self.0 &= !bit(card);
    }

    pub const fn contains(self, card: Card) -> bool {
        self.0 & bit(card) != 0
    }

    pub const fn union(self, other: CardMask) -> CardMask {
        CardMask(self.0 | other.0)
    }

    /// True if the two sets share at least one card.
    pub const fn intersects(self, other: CardMask) -> bool {
        self.0 & other.0 != 0
    }

    pub const fn len(self) -> u32 {
        self.0.count_ones()
    }

    pub const fn is_empty(self) -> bool {
        self.0 == 0
    }

    /// The cards in the set, lowest index first.
    pub fn iter(self) -> Cards {
        Cards(self.0)
    }
}

/// Iterator over the cards in a `CardMask`.
pub struct Cards(u64);

impl Iterator for Cards {
    type Item = Card;

    fn next(&mut self) -> Option<Card> {
        if self.0 == 0 {
            return None;
        }
        let index = self.0.trailing_zeros() as u8; // lowest set bit = next card
        self.0 &= self.0 - 1; // clear that bit
        Some(Card::from_index(index))
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        let n = self.0.count_ones() as usize;
        (n, Some(n))
    }
}

impl ExactSizeIterator for Cards {}

impl IntoIterator for CardMask {
    type Item = Card;
    type IntoIter = Cards;

    fn into_iter(self) -> Cards {
        self.iter()
    }
}

impl FromIterator<Card> for CardMask {
    fn from_iter<I: IntoIterator<Item = Card>>(cards: I) -> CardMask {
        let mut mask = CardMask::empty();
        for card in cards {
            mask.insert(card);
        }
        mask
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(s: &str) -> Card {
        s.parse().unwrap()
    }

    fn mask(cards: &[&str]) -> CardMask {
        cards.iter().map(|s| c(s)).collect()
    }

    #[test]
    fn insert_contains_len() {
        let m = mask(&["As", "Kd", "2c"]);
        assert_eq!(m.len(), 3);
        assert!(m.contains(c("As")));
        assert!(m.contains(c("Kd")));
        assert!(m.contains(c("2c")));
        assert!(!m.contains(c("Ah")));
    }

    #[test]
    fn inserting_twice_does_not_double_count() {
        let mut m = CardMask::empty();
        m.insert(c("As"));
        m.insert(c("As"));
        assert_eq!(m.len(), 1);
    }

    #[test]
    fn remove_takes_a_card_out() {
        let mut m = mask(&["As", "Kd"]);
        m.remove(c("As"));
        assert_eq!(m, mask(&["Kd"]));
    }

    #[test]
    fn intersects_detects_shared_cards() {
        assert!(mask(&["As", "Kd"]).intersects(mask(&["Kd", "Qh"])));
        assert!(!mask(&["As"]).intersects(mask(&["Kd"])));
    }

    #[test]
    fn union_combines_sets() {
        let hole = mask(&["As", "Kd"]);
        let board = mask(&["Qh", "Jc", "Ts"]);
        let all = hole.union(board);
        assert_eq!(all.len(), 5);
        assert!(!hole.intersects(board));
    }

    #[test]
    fn iter_returns_inserted_cards_lowest_first() {
        let cards: Vec<Card> = mask(&["As", "2c", "Kd"]).iter().collect();
        assert_eq!(cards, vec![c("2c"), c("Kd"), c("As")]);
    }

    #[test]
    fn full_deck_has_every_card() {
        let deck: CardMask = Card::all().collect();
        assert_eq!(deck.len(), 52);
        assert_eq!(deck, CardMask::FULL_DECK);
        assert_eq!(deck.iter().count(), 52);
    }

    #[test]
    fn empty_is_empty() {
        assert!(CardMask::empty().is_empty());
        assert_eq!(CardMask::empty().iter().next(), None);
    }
}
