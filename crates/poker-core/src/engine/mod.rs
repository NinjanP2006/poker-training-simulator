//! The game engine: one hand of No-Limit Hold'em as an event-sourced state machine.
//!
//! A hand is a list of [`HandEvent`]s (post blind, deal, act, deal board, award).
//! Every change to a [`HandState`] happens by applying one event, so the same
//! state can always be rebuilt by replaying the list. That gives hand review
//! and bug reports for free: save the events (and the deck seed), and the hand
//! can be reconstructed exactly.
//!
//! The engine is the single source of truth for whose turn it is, which
//! actions are legal, and who wins what. Amounts are integer chips throughout.

mod deck;
mod hand;
pub mod pots;

use std::fmt;

pub use deck::Deck;
pub use hand::{HandState, LegalActions, PlayerState};

use crate::card::Card;

/// The most seats a table can have.
pub const MAX_SEATS: usize = 10;

/// Everything needed to start a hand. Seats are numbered clockwise from 0.
/// (Bot profiles live in the TypeScript layer; the engine only needs chips.)
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TableConfig {
    /// Starting stack for each seat. Its length is the number of seats.
    pub stacks: Vec<u64>,
    pub small_blind: u64,
    pub big_blind: u64,
    /// Seat holding the dealer button.
    pub button: usize,
}

impl TableConfig {
    pub fn seats(&self) -> usize {
        self.stacks.len()
    }

    pub fn validate(&self) -> Result<(), EngineError> {
        let invalid = |msg: String| Err(EngineError::InvalidConfig(msg));
        let n = self.seats();
        if !(2..=MAX_SEATS).contains(&n) {
            return invalid(format!("need 2-{MAX_SEATS} seats, got {n}"));
        }
        if self.button >= n {
            return invalid(format!("button seat {} out of range", self.button));
        }
        if self.small_blind == 0 || self.small_blind > self.big_blind {
            return invalid(format!(
                "blinds must satisfy 0 < small ({}) <= big ({})",
                self.small_blind, self.big_blind
            ));
        }
        if let Some(seat) = self.stacks.iter().position(|&s| s == 0) {
            return invalid(format!("seat {seat} has an empty stack"));
        }
        Ok(())
    }
}

/// A player decision. `Bet` and `Raise` amounts are the player's *total* for
/// the street, not the increase: "raise to 60", not "raise by 40".
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Fold,
    Check,
    Call,
    /// Open the betting on a street where nobody has bet yet.
    Bet {
        amount: u64,
    },
    /// Increase an existing bet.
    Raise {
        to: u64,
    },
    /// Put in every remaining chip; acts as a call, bet or raise as appropriate.
    AllIn,
}

/// One step of a hand. Applying the full list in order rebuilds the hand.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum HandEvent {
    Blind {
        seat: usize,
        amount: u64,
    },
    Deal {
        seat: usize,
        cards: [Card; 2],
    },
    Act {
        seat: usize,
        action: Action,
    },
    Board {
        cards: Vec<Card>,
    },
    /// Chips from pot number `pot` (0 = main pot) paid to one seat. A split pot
    /// produces one event per winner, so odd chips are explicit.
    Award {
        pot: usize,
        seat: usize,
        amount: u64,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Street {
    Preflop,
    Flop,
    Turn,
    River,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EngineError {
    InvalidConfig(String),
    /// Nobody is due to act: the hand is over, or between deals.
    NoActionPending,
    NotYourTurn {
        expected: usize,
        got: usize,
    },
    IllegalAction {
        action: Action,
        reason: String,
    },
    /// A saved event list doesn't describe a valid hand.
    ReplayMismatch(String),
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EngineError::InvalidConfig(msg) => write!(f, "invalid table config: {msg}"),
            EngineError::NoActionPending => write!(f, "no player is due to act"),
            EngineError::NotYourTurn { expected, got } => {
                write!(f, "seat {got} acted, but it is seat {expected}'s turn")
            }
            EngineError::IllegalAction { action, reason } => {
                write!(f, "illegal action {action:?}: {reason}")
            }
            EngineError::ReplayMismatch(msg) => write!(f, "replay mismatch: {msg}"),
        }
    }
}

impl std::error::Error for EngineError {}
