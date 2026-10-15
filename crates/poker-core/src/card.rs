use std::fmt;
use std::str::FromStr;

/// Rank characters, indexed by rank (0 = deuce … 12 = ace).
const RANKS: &[u8; 13] = b"23456789TJQKA";
/// Suit characters, indexed by suit (0 = clubs, 1 = diamonds, 2 = hearts, 3 = spades).
const SUITS: &[u8; 4] = b"cdhs";

/// A playing card, stored as `rank * 4 + suit` (0–51).
///
/// Because 4 is a power of two, the suit is the low 2 bits and the rank is
/// everything above them, so both are a single bit operation away.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct Card(u8);

impl Card {
    /// Builds a card from a rank (0–12) and suit (0–3). Panics if either is out of range.
    pub const fn new(rank: u8, suit: u8) -> Card {
        assert!(rank < 13 && suit < 4, "rank must be 0-12 and suit 0-3");
        Card(rank * 4 + suit)
    }

    /// Builds a card from its index (0–51). Panics if out of range.
    pub const fn from_index(index: u8) -> Card {
        assert!(index < 52, "card index must be 0-51");
        Card(index)
    }

    pub const fn index(self) -> u8 {
        self.0
    }

    pub const fn rank(self) -> u8 {
        self.0 >> 2
    }

    pub const fn suit(self) -> u8 {
        self.0 & 3
    }

    /// All 52 cards in index order (2c, 2d, 2h, 2s, 3c, … As).
    pub fn all() -> impl Iterator<Item = Card> {
        (0..52).map(Card)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseCardError(String);

impl fmt::Display for ParseCardError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "invalid card {:?}: expected rank + suit like \"As\" or \"Td\"",
            self.0
        )
    }
}

impl std::error::Error for ParseCardError {}

impl FromStr for Card {
    type Err = ParseCardError;

    /// Parses two characters: a rank (`23456789TJQKA`) then a suit (`cdhs`).
    /// Case-insensitive, so `"as"` and `"AS"` both mean the ace of spades.
    fn from_str(s: &str) -> Result<Card, ParseCardError> {
        let err = || ParseCardError(s.to_string());

        let mut chars = s.chars();
        let (Some(r), Some(su), None) = (chars.next(), chars.next(), chars.next()) else {
            return Err(err());
        };

        let rank = RANKS
            .iter()
            .position(|&b| b as char == r.to_ascii_uppercase())
            .ok_or_else(err)?;
        let suit = SUITS
            .iter()
            .position(|&b| b as char == su.to_ascii_lowercase())
            .ok_or_else(err)?;

        Ok(Card::new(rank as u8, suit as u8))
    }
}

impl fmt::Display for Card {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let r = RANKS[self.rank() as usize] as char;
        let s = SUITS[self.suit() as usize] as char;
        write!(f, "{r}{s}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(s: &str) -> Card {
        s.parse().unwrap()
    }

    #[test]
    fn parses_known_cards() {
        assert_eq!(c("2c").index(), 0);
        assert_eq!(c("As").index(), 51);
        assert_eq!(c("Td").index(), 33); // rank 8 * 4 + suit 1
    }

    #[test]
    fn rank_and_suit_come_back_out() {
        let ace_spades = c("As");
        assert_eq!(ace_spades.rank(), 12);
        assert_eq!(ace_spades.suit(), 3);
        assert_eq!(Card::new(12, 3), ace_spades);
    }

    #[test]
    fn parsing_is_case_insensitive() {
        assert_eq!(c("as"), c("As"));
        assert_eq!(c("TD"), c("Td"));
    }

    #[test]
    fn every_card_round_trips_through_text() {
        for card in Card::all() {
            assert_eq!(c(&card.to_string()), card, "round trip failed for {card}");
        }
    }

    #[test]
    fn all_yields_52_distinct_cards() {
        let cards: Vec<Card> = Card::all().collect();
        assert_eq!(cards.len(), 52);
        assert_eq!(cards[0], c("2c"));
        assert_eq!(cards[51], c("As"));
    }

    #[test]
    fn rejects_bad_input() {
        for bad in ["", "A", "1s", "Ax", "Asd", "10s", " As"] {
            assert!(bad.parse::<Card>().is_err(), "{bad:?} should not parse");
        }
    }

    #[test]
    #[should_panic]
    fn new_panics_on_bad_rank() {
        Card::new(13, 0);
    }
}
