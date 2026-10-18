//! One hand of No-Limit Hold'em as an event-sourced state machine.
//!
//! The only function that changes a `HandState` is `apply_event`. Live play
//! (`new`, `apply_action`) works by *recording* events: build the event,
//! apply it, append it to the log. After each player action the engine also
//! records whatever follows automatically: dealing the next street, running
//! out the board when everyone is all-in, and awarding the pots. Replaying a
//! saved log just applies its events in order, so it reaches the same state.
//!
//! Whose turn it is isn't stored; `to_act` works it out from the bets, so it
//! can't drift out of sync with them.

use super::pots;
use super::{Action, Deck, EngineError, HandEvent, Street, TableConfig};
use crate::card::Card;
use crate::eval::{HandRank, fast};
use crate::mask::CardMask;

/// One seat's state during the hand.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlayerState {
    /// Hole cards, once dealt.
    pub hole: Option<[Card; 2]>,
    /// Chips behind, not yet in the pot.
    pub stack: u64,
    /// Chips put in on the current street.
    pub street_bet: u64,
    /// Chips put in over the whole hand. Side pots are built from this.
    pub total_bet: u64,
    pub folded: bool,
    /// Has acted on this street. Posting a blind doesn't count, which is what
    /// gives the big blind its option when everyone limps.
    acted: bool,
    /// The bet level this player last matched or set; used to decide whether
    /// betting has been reopened for them.
    level_when_acted: u64,
}

impl PlayerState {
    pub fn is_all_in(&self) -> bool {
        !self.folded && self.stack == 0
    }

    fn can_act(&self) -> bool {
        !self.folded && self.stack > 0
    }
}

/// What the player to act may do. Bet and raise amounts are street totals.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LegalActions {
    pub seat: usize,
    /// Chips needed to call, capped at the player's stack. 0 means they can check.
    pub to_call: u64,
    /// Calling would put the player all-in.
    pub call_is_all_in: bool,
    /// Smallest legal bet/raise total, or `None` if they can't bet or raise.
    /// If their stack is short of a full raise, this equals `max_raise_to`.
    pub min_raise_to: Option<u64>,
    /// Largest bet/raise total: everything they have.
    pub max_raise_to: u64,
    /// Nobody has bet this street, so the aggressive action is `Bet`, not `Raise`.
    pub is_bet: bool,
}

impl LegalActions {
    /// `Ok` if `action` is allowed, otherwise the reason it isn't.
    pub fn check(&self, action: &Action) -> Result<(), String> {
        match *action {
            Action::Fold if self.to_call == 0 => Err("nothing to call; check instead".into()),
            Action::Fold => Ok(()),
            Action::Check if self.to_call > 0 => Err(format!("facing a bet of {}", self.to_call)),
            Action::Check => Ok(()),
            Action::Call if self.to_call == 0 => Err("nothing to call".into()),
            Action::Call => Ok(()),
            Action::Bet { .. } if !self.is_bet => Err("there is already a bet; use Raise".into()),
            Action::Bet { amount } => self.check_raise_size(amount),
            Action::Raise { .. } if self.is_bet => Err("nobody has bet yet; use Bet".into()),
            Action::Raise { to } => self.check_raise_size(to),
            Action::AllIn if self.min_raise_to.is_some() => Ok(()),
            Action::AllIn if self.call_is_all_in => Ok(()),
            Action::AllIn => Err("going all-in would be a raise, and raising isn't allowed".into()),
        }
    }

    fn check_raise_size(&self, to: u64) -> Result<(), String> {
        match self.min_raise_to {
            None => Err("raising isn't allowed here".into()),
            Some(min) if to < min => Err(format!("minimum is {min}")),
            Some(_) if to > self.max_raise_to => {
                Err(format!("maximum (all-in) is {}", self.max_raise_to))
            }
            Some(_) => Ok(()),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HandState {
    config: TableConfig,
    deck: Deck,
    /// How many cards have been dealt from the top of the deck.
    dealt: usize,
    events: Vec<HandEvent>,
    players: Vec<PlayerState>,
    board: Vec<Card>,
    /// Highest `street_bet` this street: what everyone must match.
    current_bet: u64,
    /// Size of the last full bet or raise this street; a raise must add at least this much.
    last_full_raise: u64,
    /// Times a player increased the bet this street (blinds don't count): 1 after
    /// an open or a flop bet, 2 after a 3-bet or a raise of that bet, and so on.
    raises_this_street: u32,
    /// Where to start looking clockwise for the next player to act.
    search_from: usize,
    /// Chips paid out by award events so far.
    awarded: u64,
}

impl HandState {
    /// Starts a hand with a deck shuffled from `seed`: posts blinds and deals.
    pub fn new(config: TableConfig, seed: u64) -> Result<HandState, EngineError> {
        HandState::with_deck(config, Deck::shuffled(seed))
    }

    /// Starts a hand with a specific deck order.
    pub fn with_deck(config: TableConfig, deck: Deck) -> Result<HandState, EngineError> {
        let mut hand = HandState::empty(config, deck)?;
        let n = hand.seats();
        let (sb_seat, bb_seat) = hand.blind_seats();
        let sb = hand.config.small_blind.min(hand.players[sb_seat].stack);
        let bb = hand.config.big_blind.min(hand.players[bb_seat].stack);
        hand.record(HandEvent::Blind {
            seat: sb_seat,
            amount: sb,
        });
        hand.record(HandEvent::Blind {
            seat: bb_seat,
            amount: bb,
        });
        for i in 0..n {
            let seat = (hand.config.button + 1 + i) % n;
            let cards = [hand.deck.card(hand.dealt), hand.deck.card(hand.dealt + 1)];
            hand.record(HandEvent::Deal { seat, cards });
        }
        hand.run_automatic_events(); // e.g. both players all-in from the blinds
        Ok(hand)
    }

    /// Rebuilds a hand from a saved event list. `deck` must be the deck the
    /// hand was dealt from (`Deck::shuffled(seed)` for a seeded hand); dealt
    /// cards are checked against it.
    pub fn replay(
        config: TableConfig,
        deck: Deck,
        events: &[HandEvent],
    ) -> Result<HandState, EngineError> {
        let mut hand = HandState::empty(config, deck)?;
        for event in events {
            hand.apply_event(event)?;
            hand.events.push(event.clone());
        }
        Ok(hand)
    }

    /// Applies the current player's action, then deals or awards whatever follows.
    /// On error the state is unchanged.
    pub fn apply_action(&mut self, action: Action) -> Result<(), EngineError> {
        let legal = self.legal_actions().ok_or(EngineError::NoActionPending)?;
        legal
            .check(&action)
            .map_err(|reason| EngineError::IllegalAction { action, reason })?;
        self.record(HandEvent::Act {
            seat: legal.seat,
            action,
        });
        self.run_automatic_events();
        Ok(())
    }

    // ----- Queries -----

    pub fn config(&self) -> &TableConfig {
        &self.config
    }

    pub fn events(&self) -> &[HandEvent] {
        &self.events
    }

    pub fn players(&self) -> &[PlayerState] {
        &self.players
    }

    pub fn board(&self) -> &[Card] {
        &self.board
    }

    pub fn street(&self) -> Street {
        match self.board.len() {
            0 => Street::Preflop,
            3 => Street::Flop,
            4 => Street::Turn,
            _ => Street::River,
        }
    }

    /// Chips in the middle that haven't been awarded yet.
    pub fn pot(&self) -> u64 {
        self.total_contributed() - self.awarded
    }

    pub fn current_bet(&self) -> u64 {
        self.current_bet
    }

    /// Times a player increased the bet this street. Preflop, 0 means nobody
    /// has raised the blinds yet; 1 means one open raise; 2 a 3-bet.
    pub fn raises_this_street(&self) -> u32 {
        self.raises_this_street
    }

    /// True once every chip in the pot has been awarded.
    pub fn is_complete(&self) -> bool {
        self.awarded > 0 && self.awarded == self.total_contributed()
    }

    /// The seat due to act, or `None` if nobody is (hand over, or dealing next).
    pub fn to_act(&self) -> Option<usize> {
        // Once pots are being paid out, betting is over. (Checking `awarded`
        // rather than `is_complete` matters: an all-in player who has just won
        // a pot has chips again but must not be asked to act.)
        if self.awarded > 0 || self.live_count() <= 1 || !self.all_dealt() {
            return None;
        }
        let n = self.seats();
        let can_act = self.players.iter().filter(|p| p.can_act()).count();
        (0..n)
            .map(|i| (self.search_from + i) % n)
            .find(|&seat| self.needs_action(seat, can_act))
    }

    pub fn legal_actions(&self) -> Option<LegalActions> {
        let seat = self.to_act()?;
        let p = &self.players[seat];
        let owed = self.owed(seat);
        let max_raise_to = p.street_bet + p.stack;

        // A player who already acted this street may raise again only if the
        // bet has since gone up by at least a full raise. One short all-in
        // doesn't reopen the betting; several that add up to a full raise do.
        let reopened = !p.acted || self.current_bet - p.level_when_acted >= self.last_full_raise;
        let has_chips_to_raise = max_raise_to > self.current_bet;
        let someone_can_respond = self.others_can_act(seat);
        let min_raise_to = (reopened && has_chips_to_raise && someone_can_respond)
            .then(|| (self.current_bet + self.last_full_raise).min(max_raise_to));

        Some(LegalActions {
            seat,
            to_call: owed.min(p.stack),
            call_is_all_in: owed > 0 && owed >= p.stack,
            min_raise_to,
            max_raise_to,
            is_bet: self.current_bet == 0,
        })
    }

    // ----- Internals -----

    fn empty(config: TableConfig, deck: Deck) -> Result<HandState, EngineError> {
        config.validate()?;
        let players = config
            .stacks
            .iter()
            .map(|&stack| PlayerState {
                hole: None,
                stack,
                street_bet: 0,
                total_bet: 0,
                folded: false,
                acted: false,
                level_when_acted: 0,
            })
            .collect();
        let mut hand = HandState {
            current_bet: config.big_blind,
            last_full_raise: config.big_blind,
            raises_this_street: 0,
            search_from: 0,
            config,
            deck,
            dealt: 0,
            events: Vec::new(),
            players,
            board: Vec::new(),
            awarded: 0,
        };
        let (_, bb_seat) = hand.blind_seats();
        hand.search_from = (bb_seat + 1) % hand.seats(); // preflop: first to act is left of the big blind
        Ok(hand)
    }

    fn seats(&self) -> usize {
        self.players.len()
    }

    /// Heads-up, the button posts the small blind; otherwise the two seats
    /// to its left post.
    fn blind_seats(&self) -> (usize, usize) {
        let n = self.seats();
        let b = self.config.button;
        if n == 2 {
            (b, (b + 1) % n)
        } else {
            ((b + 1) % n, (b + 2) % n)
        }
    }

    fn live_count(&self) -> usize {
        self.players.iter().filter(|p| !p.folded).count()
    }

    fn all_dealt(&self) -> bool {
        self.players.iter().all(|p| p.hole.is_some())
    }

    fn total_contributed(&self) -> u64 {
        self.players.iter().map(|p| p.total_bet).sum()
    }

    /// A player must act if they owe chips, or haven't acted yet this street
    /// and at least one other player could still respond.
    fn needs_action(&self, seat: usize, can_act: usize) -> bool {
        let p = &self.players[seat];
        p.can_act() && (self.owed(seat) > 0 || (!p.acted && can_act >= 2))
    }

    fn others_can_act(&self, seat: usize) -> bool {
        self.players
            .iter()
            .enumerate()
            .any(|(i, q)| i != seat && q.can_act())
    }

    /// Chips `seat` must add to stay in the hand.
    ///
    /// Normally that's the gap to the current bet. The exception is a short
    /// all-in big blind: the bet to call is still the full blind (so other
    /// players must call the full amount), but once nobody else can act, only
    /// chips opponents actually put in count. A player who already matches
    /// every remaining opponent has nothing left to call.
    fn owed(&self, seat: usize) -> u64 {
        let target = if self.others_can_act(seat) {
            self.current_bet
        } else {
            self.players
                .iter()
                .enumerate()
                .filter(|&(i, q)| i != seat && !q.folded)
                .map(|(_, q)| q.street_bet)
                .max()
                .unwrap_or(0)
                .min(self.current_bet)
        };
        target.saturating_sub(self.players[seat].street_bet)
    }

    /// No one is due to act and the hand isn't over: the next street (or a
    /// showdown) is due.
    fn betting_closed(&self) -> bool {
        self.all_dealt() && !self.is_complete() && self.to_act().is_none()
    }

    /// Applies an event the engine itself built, and logs it.
    fn record(&mut self, event: HandEvent) {
        if let Err(e) = self.apply_event(&event) {
            panic!("engine produced an invalid event {event:?}: {e}");
        }
        self.events.push(event);
    }

    /// After an action: deal the next street(s) or award the pots, until
    /// someone needs to act or the hand is over.
    fn run_automatic_events(&mut self) {
        while self.betting_closed() {
            if self.live_count() >= 2 && self.board.len() < 5 {
                let count = if self.board.is_empty() { 3 } else { 1 };
                let cards = (0..count).map(|i| self.deck.card(self.dealt + i)).collect();
                self.record(HandEvent::Board { cards });
            } else {
                for event in self.award_events() {
                    self.record(event);
                }
            }
        }
    }

    fn award_events(&self) -> Vec<HandEvent> {
        let contributions: Vec<u64> = self.players.iter().map(|p| p.total_bet).collect();
        let folded: Vec<bool> = self.players.iter().map(|p| p.folded).collect();
        let ranks: Vec<Option<HandRank>> =
            self.players.iter().map(|p| self.showdown_rank(p)).collect();

        let mut events = Vec::new();
        for (index, pot) in pots::build_pots(&contributions, &folded).iter().enumerate() {
            for (seat, amount) in pots::split_pot(pot, &ranks, self.config.button) {
                if amount > 0 {
                    events.push(HandEvent::Award {
                        pot: index,
                        seat,
                        amount,
                    });
                }
            }
        }
        events
    }

    fn showdown_rank(&self, p: &PlayerState) -> Option<HandRank> {
        if p.folded || self.board.len() != 5 {
            return None;
        }
        let cards: CardMask = p.hole?.iter().chain(&self.board).copied().collect();
        Some(fast::eval_mask(cards))
    }

    /// Moves chips from a player's stack into the pot.
    fn put_in(&mut self, seat: usize, amount: u64) {
        let p = &mut self.players[seat];
        p.stack -= amount;
        p.street_bet += amount;
        p.total_bet += amount;
    }

    /// The single place where state changes. Validates the event first, so a
    /// corrupt saved hand is rejected instead of producing a nonsense state.
    fn apply_event(&mut self, event: &HandEvent) -> Result<(), EngineError> {
        let mismatch = |msg: String| Err(EngineError::ReplayMismatch(msg));
        match event {
            &HandEvent::Blind { seat, amount } => {
                if seat >= self.seats() || amount > self.players[seat].stack {
                    return mismatch(format!("blind of {amount} from seat {seat}"));
                }
                self.put_in(seat, amount);
            }
            &HandEvent::Deal { seat, cards } => {
                let expected = [self.deck.card(self.dealt), self.deck.card(self.dealt + 1)];
                if seat >= self.seats() || self.players[seat].hole.is_some() || cards != expected {
                    return mismatch(format!("deal of {cards:?} to seat {seat}"));
                }
                self.players[seat].hole = Some(cards);
                self.dealt += 2;
            }
            &HandEvent::Act { seat, action } => self.act(seat, action)?,
            HandEvent::Board { cards } => {
                let expected_count = if self.board.is_empty() { 3 } else { 1 };
                let expected: Vec<Card> = (0..expected_count)
                    .map(|i| self.deck.card(self.dealt + i))
                    .collect();
                if !self.betting_closed()
                    || self.live_count() < 2
                    || self.board.len() >= 5
                    || *cards != expected
                {
                    return mismatch(format!("board {cards:?} dealt out of turn or out of order"));
                }
                self.board.extend(cards);
                self.dealt += cards.len();
                self.start_street();
            }
            &HandEvent::Award { seat, amount, .. } => {
                let showdown_or_folds = self.live_count() <= 1 || self.board.len() == 5;
                if !self.betting_closed()
                    || !showdown_or_folds
                    || seat >= self.seats()
                    || amount > self.pot()
                {
                    return mismatch(format!("award of {amount} to seat {seat}"));
                }
                self.players[seat].stack += amount;
                self.awarded += amount;
            }
        }
        Ok(())
    }

    fn act(&mut self, seat: usize, action: Action) -> Result<(), EngineError> {
        let legal = self.legal_actions().ok_or(EngineError::NoActionPending)?;
        if legal.seat != seat {
            return Err(EngineError::NotYourTurn {
                expected: legal.seat,
                got: seat,
            });
        }
        legal
            .check(&action)
            .map_err(|reason| EngineError::IllegalAction { action, reason })?;

        let street_bet = self.players[seat].street_bet;
        let new_total = match action {
            Action::Fold => {
                self.players[seat].folded = true;
                None
            }
            Action::Check => None,
            Action::Call => Some(street_bet + legal.to_call),
            Action::Bet { amount } => Some(amount),
            Action::Raise { to } => Some(to),
            Action::AllIn => Some(legal.max_raise_to),
        };

        if let Some(to) = new_total {
            self.put_in(seat, to - street_bet);
            if to > self.current_bet {
                let increase = to - self.current_bet;
                // Only a full raise sets the new minimum; a short all-in leaves it alone.
                if increase >= self.last_full_raise {
                    self.last_full_raise = increase;
                }
                self.current_bet = to;
                self.raises_this_street += 1;
            }
        }

        let p = &mut self.players[seat];
        p.acted = true;
        p.level_when_acted = self.current_bet;
        self.search_from = (seat + 1) % self.seats();
        Ok(())
    }

    /// Resets betting for a new street. Postflop, the first live seat left of the button acts first.
    fn start_street(&mut self) {
        for p in &mut self.players {
            p.street_bet = 0;
            p.acted = false;
            p.level_when_acted = 0;
        }
        self.current_bet = 0;
        self.last_full_raise = self.config.big_blind;
        self.raises_this_street = 0;
        self.search_from = (self.config.button + 1) % self.seats();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(stacks: &[u64], button: usize) -> TableConfig {
        TableConfig {
            stacks: stacks.to_vec(),
            small_blind: 1,
            big_blind: 2,
            button,
        }
    }

    /// A deck whose top cards are `cards`. Hole cards go two at a time to each
    /// seat starting left of the button, then flop, turn and river.
    fn deck(cards: &str) -> Deck {
        let top: Vec<Card> = cards
            .split_whitespace()
            .map(|c| c.parse().unwrap())
            .collect();
        Deck::stacked(&top)
    }

    fn act(hand: &mut HandState, action: Action) {
        let seat = hand.to_act();
        hand.apply_action(action)
            .unwrap_or_else(|e| panic!("seat {seat:?}: {action:?} rejected: {e}"));
    }

    fn stacks(hand: &HandState) -> Vec<u64> {
        hand.players().iter().map(|p| p.stack).collect()
    }

    fn awards(hand: &HandState) -> Vec<(usize, usize, u64)> {
        hand.events()
            .iter()
            .filter_map(|e| match *e {
                HandEvent::Award { pot, seat, amount } => Some((pot, seat, amount)),
                _ => None,
            })
            .collect()
    }

    // ----- Setup and turn order -----

    #[test]
    fn rejects_invalid_configs() {
        assert!(HandState::new(config(&[100], 0), 1).is_err());
        assert!(HandState::new(config(&[100, 100], 2), 1).is_err());
        assert!(HandState::new(config(&[100, 0], 0), 1).is_err());
        let mut bad_blinds = config(&[100, 100], 0);
        bad_blinds.small_blind = 5;
        assert!(HandState::new(bad_blinds, 1).is_err());
    }

    #[test]
    fn heads_up_button_posts_small_blind_and_acts_first_preflop_last_after() {
        let mut hand = HandState::new(config(&[100, 100], 0), 1).unwrap();
        assert_eq!(stacks(&hand), vec![99, 98]);
        assert_eq!(hand.to_act(), Some(0));

        act(&mut hand, Action::Call);
        // The big blind gets the option even though the bets are equal.
        assert_eq!(hand.to_act(), Some(1));
        let legal = hand.legal_actions().unwrap();
        assert_eq!(legal.to_call, 0);
        assert_eq!(legal.min_raise_to, Some(4));

        act(&mut hand, Action::Check);
        assert_eq!(hand.street(), Street::Flop);
        assert_eq!(hand.board().len(), 3);
        assert_eq!(hand.to_act(), Some(1)); // big blind acts first after the flop
    }

    #[test]
    fn six_max_positions() {
        let mut hand = HandState::new(config(&[100; 6], 3), 1).unwrap();
        // Button 3: small blind 4, big blind 5, under the gun 0.
        assert_eq!(stacks(&hand), vec![100, 100, 100, 100, 99, 98]);
        assert_eq!(hand.to_act(), Some(0));
        for _ in 0..3 {
            act(&mut hand, Action::Fold); // seats 0, 1, 2
        }
        act(&mut hand, Action::Call); // button
        act(&mut hand, Action::Call); // small blind completes
        act(&mut hand, Action::Check); // big blind
        assert_eq!(hand.street(), Street::Flop);
        assert_eq!(hand.to_act(), Some(4)); // small blind acts first postflop
    }

    #[test]
    fn everyone_folds_to_the_big_blind() {
        let mut hand = HandState::new(config(&[100, 100], 0), 1).unwrap();
        act(&mut hand, Action::Fold);
        assert!(hand.is_complete());
        assert_eq!(hand.board().len(), 0);
        assert_eq!(stacks(&hand), vec![99, 101]);
        assert_eq!(awards(&hand), vec![(0, 1, 3)]);
    }

    #[test]
    fn check_and_fold_only_when_they_make_sense() {
        let mut hand = HandState::new(config(&[100, 100], 0), 1).unwrap();
        let before = hand.clone();
        assert!(matches!(
            hand.apply_action(Action::Check),
            Err(EngineError::IllegalAction { .. })
        ));
        assert_eq!(hand, before, "a rejected action must not change the state");
        act(&mut hand, Action::Call);
        assert!(hand.apply_action(Action::Fold).is_err()); // big blind can check for free
        assert!(hand.apply_action(Action::Bet { amount: 10 }).is_err()); // preflop is always a raise
    }

    // ----- Raise sizing -----

    #[test]
    fn minimum_raise_is_the_size_of_the_last_raise() {
        let mut hand = HandState::new(config(&[1000, 1000], 0), 1).unwrap();
        assert_eq!(hand.legal_actions().unwrap().min_raise_to, Some(4));
        assert!(hand.apply_action(Action::Raise { to: 3 }).is_err());

        act(&mut hand, Action::Raise { to: 6 }); // a raise of 4
        assert_eq!(hand.legal_actions().unwrap().min_raise_to, Some(10));
        assert!(hand.apply_action(Action::Raise { to: 9 }).is_err());
        act(&mut hand, Action::Raise { to: 10 });
        assert_eq!(hand.legal_actions().unwrap().min_raise_to, Some(14));
    }

    #[test]
    fn counts_raises_per_street() {
        let mut hand = HandState::new(config(&[1000, 1000, 1000], 0), 1).unwrap();
        assert_eq!(hand.raises_this_street(), 0); // blinds don't count
        act(&mut hand, Action::Call); // a limp doesn't either
        act(&mut hand, Action::Raise { to: 8 });
        assert_eq!(hand.raises_this_street(), 1);
        act(&mut hand, Action::Raise { to: 24 });
        assert_eq!(hand.raises_this_street(), 2);
        act(&mut hand, Action::Call);
        act(&mut hand, Action::Call);
        assert_eq!(hand.street(), Street::Flop);
        assert_eq!(hand.raises_this_street(), 0);
        act(&mut hand, Action::Bet { amount: 20 });
        assert_eq!(hand.raises_this_street(), 1);
    }

    #[test]
    fn minimum_bet_after_the_flop_is_the_big_blind() {
        let mut hand = HandState::new(config(&[1000, 1000], 0), 1).unwrap();
        act(&mut hand, Action::Call);
        act(&mut hand, Action::Check);
        let legal = hand.legal_actions().unwrap();
        assert!(legal.is_bet);
        assert_eq!(legal.min_raise_to, Some(2));
        assert!(hand.apply_action(Action::Raise { to: 10 }).is_err()); // nothing to raise yet
        act(&mut hand, Action::Bet { amount: 10 });
        assert_eq!(hand.legal_actions().unwrap().min_raise_to, Some(20));
    }

    #[test]
    fn short_all_in_does_not_reopen_betting() {
        // Button 0, small blind 1, big blind 2 (only 15 chips). Seat 0 acts first.
        let mut hand = HandState::new(config(&[1000, 1000, 15], 0), 1).unwrap();
        act(&mut hand, Action::Raise { to: 10 }); // seat 0, a raise of 8
        act(&mut hand, Action::Call); // seat 1
        act(&mut hand, Action::AllIn); // seat 2: to 15, only 5 more, not a full raise

        let legal = hand.legal_actions().unwrap();
        assert_eq!(legal.seat, 0);
        assert_eq!(legal.to_call, 5);
        assert_eq!(
            legal.min_raise_to, None,
            "seat 0 already acted and faces less than a full raise"
        );
        assert!(hand.apply_action(Action::Raise { to: 30 }).is_err());
        assert!(hand.apply_action(Action::AllIn).is_err());
        act(&mut hand, Action::Call);
        act(&mut hand, Action::Call); // seat 1 likewise can only call or fold
        assert_eq!(hand.street(), Street::Flop);
    }

    #[test]
    fn full_raise_all_in_does_reopen_betting() {
        let mut hand = HandState::new(config(&[1000, 1000, 30], 0), 1).unwrap();
        act(&mut hand, Action::Raise { to: 10 });
        act(&mut hand, Action::Call);
        act(&mut hand, Action::AllIn); // to 30: 20 more, at least the last raise of 8
        let legal = hand.legal_actions().unwrap();
        assert_eq!(legal.seat, 0);
        assert_eq!(legal.min_raise_to, Some(50)); // 30 + the new raise size of 20
    }

    #[test]
    fn short_all_ins_that_add_up_to_a_full_raise_reopen_betting() {
        // Button 0, small blind 1 (22 chips), big blind 2, under the gun 3.
        let mut hand = HandState::new(config(&[15, 22, 1000, 1000], 0), 1).unwrap();
        act(&mut hand, Action::Raise { to: 10 }); // seat 3, a raise of 8
        act(&mut hand, Action::AllIn); // seat 0: to 15 (+5, short)
        act(&mut hand, Action::AllIn); // seat 1: to 22 (+7, short)
        act(&mut hand, Action::Call); // seat 2 calls 22
        let legal = hand.legal_actions().unwrap();
        assert_eq!(legal.seat, 3);
        // Seat 3 last acted at 10 and now faces 22: 12 more, at least a full raise of 8.
        assert_eq!(legal.min_raise_to, Some(30));
    }

    #[test]
    fn no_raising_when_everyone_else_is_all_in() {
        let mut hand = HandState::new(config(&[1000, 50], 0), 1).unwrap();
        act(&mut hand, Action::Raise { to: 6 });
        act(&mut hand, Action::AllIn); // seat 1 all-in for 50
        let legal = hand.legal_actions().unwrap();
        assert_eq!(legal.min_raise_to, None);
        assert!(hand.apply_action(Action::AllIn).is_err()); // that would be a raise nobody can call
        act(&mut hand, Action::Call);
        assert!(hand.is_complete()); // board runs out automatically
        assert_eq!(hand.board().len(), 5);
    }

    // ----- Showdowns and side pots -----

    #[test]
    fn all_in_preflop_runs_out_the_board_and_pays_the_winner() {
        let deck = deck("As Ad Ks Kd 2c 7d 9h 4s 3c");
        let mut hand = HandState::with_deck(config(&[100, 100], 1), deck).unwrap();
        // Button 1 posts small blind and is dealt second: seat 0 gets AA, seat 1 KK.
        act(&mut hand, Action::AllIn);
        act(&mut hand, Action::Call);
        assert!(hand.is_complete());
        assert_eq!(hand.board().len(), 5);
        assert_eq!(stacks(&hand), vec![200, 0]);
    }

    #[test]
    fn four_way_all_in_builds_three_side_pots() {
        // Button 3; deal order 0, 1, 2, 3. Best hand is the shortest stack, and so on.
        let deck = deck("As Ad Ks Kd Qs Qd Jh Jc 2c 7d 9h 4s 3c");
        let mut hand = HandState::with_deck(config(&[50, 100, 200, 400], 3), deck).unwrap();
        act(&mut hand, Action::AllIn); // seat 2 (under the gun) to 200
        act(&mut hand, Action::AllIn); // seat 3 (button) to 400
        act(&mut hand, Action::Call); // seat 0 calls all-in for 50
        act(&mut hand, Action::Call); // seat 1 calls all-in for 100
        assert!(hand.is_complete());
        assert_eq!(
            awards(&hand),
            vec![
                (0, 0, 200), // main pot: 50 x 4, won by AA
                (1, 1, 150), // side pot 1: 50 x 3, won by KK
                (2, 2, 200), // side pot 2: 100 x 2, won by QQ
                (3, 3, 200), // seat 3's uncalled 200 comes back
            ]
        );
        assert_eq!(stacks(&hand), vec![200, 150, 200, 200]);
    }

    #[test]
    fn tie_for_the_main_pot_with_a_side_pot_won_outright() {
        // Button 2; deal order 0, 1, 2. Seats 0 and 1 both make aces and kings.
        let deck = deck("As Ks Ad Kh Qs Qh Ac Kd 7c 4s 2h");
        let mut hand = HandState::with_deck(config(&[50, 200, 200], 2), deck).unwrap();
        act(&mut hand, Action::AllIn); // seat 2 (button, first to act 3-handed) to 200
        act(&mut hand, Action::Call); // seat 0 all-in for 50
        act(&mut hand, Action::Call); // seat 1 calls 200
        assert_eq!(
            awards(&hand),
            vec![
                (0, 0, 75), // main pot of 150 split two ways
                (0, 1, 75),
                (1, 1, 300), // side pot: seat 1 beats seat 2
            ]
        );
        assert_eq!(stacks(&hand), vec![75, 375, 0]);
    }

    #[test]
    fn odd_chip_goes_left_of_the_button() {
        // Button 0; deal order 1, 2, 0. The board is a royal flush, so every live hand ties.
        let deck = deck("2c 3c 4d 5d 6h 7h As Ks Qs Js Ts");
        let mut hand = HandState::with_deck(config(&[100, 100, 100], 0), deck).unwrap();
        act(&mut hand, Action::Call); // seat 0 (button)
        act(&mut hand, Action::Fold); // seat 1 (small blind) leaves 1 chip behind
        act(&mut hand, Action::Check); // seat 2 (big blind)
        for _ in 0..3 {
            act(&mut hand, Action::Check); // seat 2
            act(&mut hand, Action::Check); // seat 0
        }
        // Pot of 5 splits 3 / 2; seat 2 is the first winner left of the button.
        assert_eq!(awards(&hand), vec![(0, 2, 3), (0, 0, 2)]);
        assert_eq!(stacks(&hand), vec![100, 99, 101]);
    }

    #[test]
    fn short_big_blind_must_still_be_called_in_full_while_others_can_act() {
        // Button 0, small blind seat 1, big blind seat 2 has only 1 chip (all-in).
        let mut hand = HandState::new(config(&[100, 100, 1], 0), 1).unwrap();
        let legal = hand.legal_actions().unwrap();
        assert_eq!(legal.seat, 0);
        assert_eq!(
            legal.to_call, 2,
            "the full big blind, not the 1 chip posted"
        );
        act(&mut hand, Action::Call);
        let legal = hand.legal_actions().unwrap();
        assert_eq!(legal.seat, 1);
        assert_eq!(legal.to_call, 1); // small blind completes
        assert!(legal.min_raise_to.is_some()); // seat 0 could still respond
    }

    #[test]
    fn short_big_blind_heads_up_leaves_nothing_to_call() {
        // Found by the property tests. The small blind (seat 1) posts 2; the
        // big blind (seat 0) has 1 chip and is all-in. The small blind already
        // covers that chip and nobody else can bet, so there is no decision:
        // the board runs out, and the unmatched chip goes back to seat 1.
        let mut cfg = config(&[1, 3], 1);
        cfg.small_blind = 2;
        cfg.big_blind = 3;
        let hand = HandState::new(cfg, 0).unwrap();
        assert!(hand.is_complete());
        assert_eq!(hand.board().len(), 5);
        assert!(
            awards(&hand)
                .iter()
                .any(|&(_, seat, amount)| seat == 1 && amount >= 1)
        );
    }

    #[test]
    fn both_all_in_from_the_blinds_needs_no_actions() {
        let hand = HandState::new(config(&[1, 2], 0), 1).unwrap();
        assert!(hand.is_complete());
        assert_eq!(hand.board().len(), 5);
    }

    // ----- Replay -----

    fn played_hand() -> HandState {
        let mut hand = HandState::new(config(&[100, 100, 100], 0), 99).unwrap();
        act(&mut hand, Action::Raise { to: 6 });
        act(&mut hand, Action::Call);
        act(&mut hand, Action::Fold);
        act(&mut hand, Action::Bet { amount: 8 });
        act(&mut hand, Action::Call);
        hand
    }

    #[test]
    fn replaying_the_events_rebuilds_the_same_state() {
        let hand = played_hand();
        let replayed =
            HandState::replay(hand.config().clone(), Deck::shuffled(99), hand.events()).unwrap();
        assert_eq!(replayed, hand);
    }

    #[test]
    fn same_seed_and_actions_give_the_same_hand() {
        assert_eq!(played_hand().events(), played_hand().events());
    }

    #[test]
    fn replay_rejects_an_action_out_of_turn() {
        let hand = played_hand();
        let mut events = hand.events().to_vec();
        let first_act = events
            .iter()
            .position(|e| matches!(e, HandEvent::Act { .. }))
            .unwrap();
        events[first_act] = HandEvent::Act {
            seat: 2,
            action: Action::Call,
        };
        let result = HandState::replay(hand.config().clone(), Deck::shuffled(99), &events);
        assert!(matches!(
            result,
            Err(EngineError::NotYourTurn {
                expected: 0,
                got: 2
            })
        ));
    }

    #[test]
    fn replay_rejects_cards_that_dont_match_the_deck() {
        let hand = played_hand();
        let result = HandState::replay(hand.config().clone(), Deck::shuffled(100), hand.events());
        assert!(matches!(result, Err(EngineError::ReplayMismatch(_))));
    }
}
