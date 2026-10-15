//! Hand evaluation: score 5–7 cards as one number where higher wins.
//!
//! `naive` is the simple, obviously-correct evaluator. It is the reference that
//! the fast evaluator (Phase 1d) is tested against.

pub mod naive;

/// Hand categories, weakest to strongest. The discriminant is the value
/// stored in the top bits of a `HandRank`.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum Category {
    HighCard = 0,
    Pair,
    TwoPair,
    Trips,
    Straight,
    Flush,
    FullHouse,
    Quads,
    StraightFlush,
}

impl Category {
    pub const ALL: [Category; 9] = [
        Category::HighCard,
        Category::Pair,
        Category::TwoPair,
        Category::Trips,
        Category::Straight,
        Category::Flush,
        Category::FullHouse,
        Category::Quads,
        Category::StraightFlush,
    ];
}

/// A hand's strength as a single comparable number: compare two `HandRank`s
/// with `>` / `==` to decide who wins or whether the pot is split.
///
/// Layout (24 bits used):
/// ```text
///   bits 20–23: category (0 = high card … 8 = straight flush)
///   bits 16–19: most important rank
///   bits 12–15, 8–11, 4–7, 0–3: next ranks, in order of importance
/// ```
/// Each rank (0–12) fits in 4 bits. The category sits above all rank bits, so
/// any pair beats any high card; within a category, the ranks break the tie in
/// order, e.g. for two pair: high pair, then low pair, then kicker.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct HandRank(u32);

impl HandRank {
    /// Packs a category and up to five ranks, most important first.
    pub(crate) fn new(category: Category, ranks: &[u8]) -> HandRank {
        debug_assert!(ranks.len() <= 5);
        let mut value = (category as u32) << 20;
        for (i, &rank) in ranks.iter().enumerate() {
            value |= (rank as u32) << (16 - 4 * i);
        }
        HandRank(value)
    }

    pub fn category(self) -> Category {
        Category::ALL[(self.0 >> 20) as usize]
    }

    pub fn value(self) -> u32 {
        self.0
    }
}
