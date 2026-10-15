//! Property tests for the game engine: play random hands, with random table
//! sizes, stacks, blinds and legal actions, and check that the rules that must
//! always hold do hold. When a case fails, proptest shrinks it to a minimal
//! failing hand and saves it so the failure is reproduced on the next run.

use poker_core::engine::{Action, Deck, HandEvent, HandState, LegalActions, TableConfig};
use poker_core::eval::fast;
use poker_core::{CardMask, HandRank};
use proptest::prelude::*;
use proptest::test_runner::TestCaseError;

/// Random tables: 2â€“9 seats, stacks from 1 to 400 chips (so short stacks and
/// all-ins are common), small blind 1â€“5, big blind 1â€“2Ã— the small blind.
fn table() -> impl Strategy<Value = TableConfig> {
    (2usize..=9, 1u64..=5).prop_flat_map(|(seats, small_blind)| {
        (
            prop::collection::vec(1u64..=400, seats),
            0..seats,
            small_blind..=2 * small_blind,
        )
            .prop_map(move |(stacks, button, big_blind)| TableConfig {
                stacks,
                small_blind,
                big_blind,
                button,
            })
    })
}

/// Turns a random number into one of the currently legal actions, covering
/// every kind of action and raise sizes anywhere in the legal range. A third
/// of choices are a plain check/call, so plenty of hands reach later streets.
fn choose(legal: &LegalActions, r: u32) -> Action {
    let passive = if legal.to_call > 0 {
        Action::Call
    } else {
        Action::Check
    };
    if (r >> 24).is_multiple_of(3) {
        return passive;
    }
    let mut options = vec![passive];
    if legal.to_call > 0 {
        options.push(Action::Fold);
    }
    if let Some(min) = legal.min_raise_to {
        let span = legal.max_raise_to - min + 1;
        let middle = min + (r as u64 >> 8) % span;
        for to in [min, middle, legal.max_raise_to] {
            options.push(if legal.is_bet {
                Action::Bet { amount: to }
            } else {
                Action::Raise { to }
            });
        }
    }
    if legal.check(&Action::AllIn).is_ok() {
        options.push(Action::AllIn);
    }
    options[r as usize % options.len()]
}

/// Actions that must be rejected in the current spot.
fn illegal_actions(legal: &LegalActions) -> Vec<Action> {
    let mut bad = vec![if legal.to_call > 0 {
        Action::Check
    } else {
        Action::Fold
    }];
    let over_max = legal.max_raise_to + 1;
    bad.push(if legal.is_bet {
        Action::Bet { amount: over_max }
    } else {
        Action::Raise { to: over_max }
    });
    if let Some(min) = legal.min_raise_to
        && min < legal.max_raise_to
    {
        let under_min = min - 1;
        bad.push(if legal.is_bet {
            Action::Bet { amount: under_min }
        } else {
            Action::Raise { to: under_min }
        });
    }
    bad
}

/// What happened in a hand, for checking that random play covers the interesting cases.
#[derive(Default)]
struct Summary {
    showdown: bool,
    pots: usize,
    split: bool,
}

fn fail(msg: String) -> TestCaseError {
    TestCaseError::fail(msg)
}

fn play(config: TableConfig, seed: u64, choices: &[u32]) -> Result<Summary, TestCaseError> {
    let total: u64 = config.stacks.iter().sum();
    let mut hand = HandState::new(config.clone(), seed).map_err(|e| fail(e.to_string()))?;

    let mut step = 0;
    while let Some(legal) = hand.legal_actions() {
        check_invariants(&hand, total)?;

        let before = hand.clone();
        for bad in illegal_actions(&legal) {
            prop_assert!(
                hand.apply_action(bad).is_err(),
                "{:?} accepted with {:?}",
                bad,
                legal
            );
            prop_assert_eq!(&hand, &before, "rejected action changed the state");
        }

        // Out of random choices: fall back to the first option (check or call),
        // which always moves the hand toward its end.
        let action = choose(&legal, choices.get(step).copied().unwrap_or(1 << 24));
        hand.apply_action(action)
            .map_err(|e| fail(format!("legal action {action:?} rejected: {e} ({legal:?})")))?;
        step += 1;
        prop_assert!(step < 1_000, "hand never finished");
    }

    prop_assert!(hand.is_complete(), "nobody to act, but the hand isn't over");
    check_invariants(&hand, total)?;
    let summary = check_result(&hand, total)?;

    let replayed = HandState::replay(config, Deck::shuffled(seed), hand.events())
        .map_err(|e| fail(format!("replay failed: {e}")))?;
    prop_assert_eq!(&replayed, &hand, "replay differs from live play");
    Ok(summary)
}

/// Rules that hold after every action.
fn check_invariants(hand: &HandState, total: u64) -> Result<(), TestCaseError> {
    let players = hand.players();

    // Chips are conserved: everything is either in a stack or in the pot.
    let in_stacks: u64 = players.iter().map(|p| p.stack).sum();
    prop_assert_eq!(in_stacks + hand.pot(), total, "chips created or destroyed");

    // Nobody puts in more than they started with.
    for (seat, p) in players.iter().enumerate() {
        prop_assert!(
            p.total_bet <= hand.config().stacks[seat],
            "seat {} overbet",
            seat
        );
    }

    // Every dealt card is unique, and the board is a legal size.
    let board = hand.board();
    prop_assert!(
        [0, 3, 4, 5].contains(&board.len()),
        "board has {} cards",
        board.len()
    );
    let mut seen = CardMask::empty();
    let dealt = players
        .iter()
        .flat_map(|p| p.hole.into_iter().flatten())
        .chain(board.iter().copied());
    let mut count = 0;
    for card in dealt {
        seen.insert(card);
        count += 1;
    }
    prop_assert_eq!(seen.len() as usize, count, "a card was dealt twice");
    Ok(())
}

/// Rules about how a finished hand was paid out.
fn check_result(hand: &HandState, total: u64) -> Result<Summary, TestCaseError> {
    let players = hand.players();
    let final_stacks: u64 = players.iter().map(|p| p.stack).sum();
    prop_assert_eq!(final_stacks, total);
    prop_assert_eq!(hand.pot(), 0);

    let awards: Vec<(usize, usize, u64)> = hand
        .events()
        .iter()
        .filter_map(|e| match *e {
            HandEvent::Award { pot, seat, amount } => Some((pot, seat, amount)),
            _ => None,
        })
        .collect();

    // Pots are numbered 0, 1, 2, â€¦ with no gaps, and each is paid to someone.
    let pot_count = awards.iter().map(|a| a.0).max().map_or(0, |m| m + 1);
    for pot in 0..pot_count {
        prop_assert!(
            awards.iter().any(|a| a.0 == pot),
            "pot {} never awarded",
            pot
        );
    }

    // Only players still in the hand win chips.
    for &(_, seat, _) in &awards {
        prop_assert!(!players[seat].folded, "folded seat {} was paid", seat);
    }

    let live: Vec<usize> = (0..players.len()).filter(|&s| !players[s].folded).collect();
    let showdown = live.len() >= 2;
    if showdown {
        // A showdown needs a full board, and the best live hand wins (part of) the main pot.
        prop_assert_eq!(hand.board().len(), 5);
        let rank = |seat: usize| -> HandRank {
            let cards: CardMask = players[seat]
                .hole
                .unwrap()
                .into_iter()
                .chain(hand.board().iter().copied())
                .collect();
            fast::eval_mask(cards)
        };
        let best = live.iter().map(|&s| rank(s)).max().unwrap();
        let best_seats: Vec<usize> = live.iter().copied().filter(|&s| rank(s) == best).collect();
        for seat in &best_seats {
            prop_assert!(
                awards.iter().any(|&(pot, s, _)| pot == 0 && s == *seat),
                "best hand at seat {} didn't win the main pot",
                seat
            );
        }
    }

    let split = (0..pot_count).any(|pot| awards.iter().filter(|a| a.0 == pot).count() > 1);
    Ok(Summary {
        showdown,
        pots: pot_count,
        split,
    })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(1_000))]

    #[test]
    fn random_hands_keep_every_invariant(
        config in table(),
        seed in any::<u64>(),
        choices in prop::collection::vec(any::<u32>(), 200),
    ) {
        play(config, seed, &choices)?;
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100_000))]

    /// The plan's bar: 100,000 random hands with no failures. Run in release
    /// (`cargo test --release -- --ignored`), as CI does.
    #[test]
    #[ignore]
    fn hundred_thousand_random_hands(
        config in table(),
        seed in any::<u64>(),
        choices in prop::collection::vec(any::<u32>(), 200),
    ) {
        play(config, seed, &choices)?;
    }
}

/// Random play is only a good test if it actually reaches the hard cases.
/// This plays 5,000 deterministic random hands and checks that showdowns,
/// multiple side pots and split pots all come up regularly.
#[test]
fn random_play_reaches_the_interesting_cases() {
    let mut state: u64 = 0x2545_F491_4F6C_DD1D;
    let mut next = move || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        state
    };

    let (mut showdowns, mut multi_pot, mut splits) = (0, 0, 0);
    for _ in 0..5_000 {
        let seats = 2 + (next() % 8) as usize;
        let small_blind = 1 + next() % 5;
        let config = TableConfig {
            stacks: (0..seats).map(|_| 1 + next() % 400).collect(),
            small_blind,
            big_blind: small_blind + next() % (small_blind + 1),
            button: (next() % seats as u64) as usize,
        };
        let choices: Vec<u32> = (0..200).map(|_| next() as u32).collect();
        let summary = play(config, next(), &choices).unwrap();
        showdowns += usize::from(summary.showdown);
        multi_pot += usize::from(summary.pots >= 3);
        splits += usize::from(summary.split);
    }
    assert!(showdowns > 1_000, "only {showdowns} showdowns");
    assert!(multi_pot > 200, "only {multi_pot} hands with 3+ pots");
    assert!(splits > 20, "only {splits} split pots");
}
