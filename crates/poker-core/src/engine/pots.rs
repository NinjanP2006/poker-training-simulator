//! Splitting the chips into a main pot and side pots, and dividing each pot
//! among its winners.

use crate::eval::HandRank;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pot {
    pub amount: u64,
    /// Seats that can win this pot, in seat order.
    pub eligible: Vec<usize>,
}

/// Builds the pots from each seat's total contribution to the hand.
///
/// Sort the distinct contribution amounts. Each one is a level: the slice of
/// chips between the previous level and this one forms a pot that only
/// players who put in at least this much can win. So a player all-in for 50
/// can win at most 50 from each opponent. Folded players' chips count toward
/// the pots, but folded players can't win them.
///
/// Adjacent levels with the same eligible players are merged, so a folded
/// player's odd contribution doesn't create an extra pot. A level that no
/// live player reached (an uncalled bet) is returned to whoever put it in.
pub fn build_pots(contributions: &[u64], folded: &[bool]) -> Vec<Pot> {
    let mut levels: Vec<u64> = contributions.iter().copied().filter(|&c| c > 0).collect();
    levels.sort_unstable();
    levels.dedup();

    let mut pots: Vec<Pot> = Vec::new();
    let mut previous = 0;
    for level in levels {
        let amount: u64 = contributions
            .iter()
            .map(|&c| c.min(level) - c.min(previous))
            .sum();
        let reached: Vec<usize> = (0..contributions.len())
            .filter(|&seat| contributions[seat] >= level)
            .collect();
        let live: Vec<usize> = reached.iter().copied().filter(|&s| !folded[s]).collect();
        let eligible = if live.is_empty() { reached } else { live };

        match pots.last_mut() {
            Some(last) if last.eligible == eligible => last.amount += amount,
            _ => pots.push(Pot { amount, eligible }),
        }
        previous = level;
    }
    pots
}

/// Divides one pot: the eligible seat(s) with the best hand share it equally.
///
/// `ranks[seat]` is that seat's showdown hand, or `None` if it has none (the
/// hand ended before showdown). Eligible seats without a rank all tie, which
/// covers the usual case of a single eligible seat taking the pot uncontested.
///
/// Chips that don't divide evenly go one at a time to the winners in seat
/// order, starting left of the button.
pub fn split_pot(pot: &Pot, ranks: &[Option<HandRank>], button: usize) -> Vec<(usize, u64)> {
    let n = ranks.len();
    let best = pot.eligible.iter().filter_map(|&s| ranks[s]).max();
    let mut winners: Vec<usize> = pot
        .eligible
        .iter()
        .copied()
        .filter(|&s| best.is_none() || ranks[s] == best)
        .collect();

    let first_left_of_button = (button + 1) % n;
    winners.sort_by_key(|&s| (s + n - first_left_of_button) % n);

    let count = winners.len() as u64;
    let share = pot.amount / count;
    let odd_chips = pot.amount % count;
    winners
        .into_iter()
        .enumerate()
        .map(|(i, seat)| (seat, share + u64::from((i as u64) < odd_chips)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::card::Card;
    use crate::eval::fast;

    fn pot(amount: u64, eligible: &[usize]) -> Pot {
        Pot {
            amount,
            eligible: eligible.to_vec(),
        }
    }

    fn rank(hand: &str) -> Option<HandRank> {
        let cards: Vec<Card> = hand
            .split_whitespace()
            .map(|c| c.parse().unwrap())
            .collect();
        Some(fast::eval(&cards))
    }

    #[test]
    fn equal_contributions_make_one_pot() {
        assert_eq!(
            build_pots(&[100, 100, 100], &[false; 3]),
            vec![pot(300, &[0, 1, 2])]
        );
    }

    #[test]
    fn three_all_ins_make_a_main_pot_and_two_side_pots() {
        // All-ins for 50, 100 and 200, plus one player covering at 200.
        let pots = build_pots(&[50, 100, 200, 200], &[false; 4]);
        assert_eq!(
            pots,
            vec![
                pot(200, &[0, 1, 2, 3]), // 50 from each of 4
                pot(150, &[1, 2, 3]),    // the next 50 from each of 3
                pot(200, &[2, 3]),       // the next 100 from each of 2
            ]
        );
        let total: u64 = pots.iter().map(|p| p.amount).sum();
        assert_eq!(total, 550);
    }

    #[test]
    fn folded_chips_are_dead_money_in_the_same_pot() {
        assert_eq!(
            build_pots(&[10, 100, 100], &[true, false, false]),
            vec![pot(210, &[1, 2])]
        );
    }

    #[test]
    fn uncalled_excess_forms_a_pot_only_its_owner_can_win() {
        assert_eq!(
            build_pots(&[100, 40], &[false, false]),
            vec![pot(80, &[0, 1]), pot(60, &[0])]
        );
    }

    #[test]
    fn level_no_live_player_reached_goes_back_to_its_owner() {
        assert_eq!(
            build_pots(&[100, 40], &[true, false]),
            vec![pot(80, &[1]), pot(60, &[0])]
        );
    }

    #[test]
    fn best_hand_takes_the_pot() {
        let ranks = [rank("As Ad 2c 7d 9h 4s 3c"), rank("Ks Kd 2c 7d 9h 4s 3c")];
        assert_eq!(split_pot(&pot(200, &[0, 1]), &ranks, 0), vec![(0, 200)]);
    }

    #[test]
    fn tie_splits_evenly() {
        let board_plays = rank("As Ks Qs Js Ts 2c 3d");
        assert_eq!(
            split_pot(&pot(200, &[0, 1]), &[board_plays, board_plays], 1),
            vec![(0, 100), (1, 100)]
        );
    }

    #[test]
    fn odd_chip_goes_to_first_winner_left_of_button() {
        let r = rank("As Ks Qs Js Ts 2c 3d");
        // Button 0: order left of the button is 1, 2, 0.
        assert_eq!(
            split_pot(&pot(5, &[0, 2]), &[r, None, r], 0),
            vec![(2, 3), (0, 2)]
        );
        // Button 2: order is 0, 1, 2.
        assert_eq!(
            split_pot(&pot(5, &[0, 2]), &[r, None, r], 2),
            vec![(0, 3), (2, 2)]
        );
    }

    #[test]
    fn three_way_split_spreads_two_odd_chips() {
        let r = rank("As Ks Qs Js Ts 2c 3d");
        assert_eq!(
            split_pot(&pot(11, &[0, 1, 2]), &[r, r, r], 0),
            vec![(1, 4), (2, 4), (0, 3)]
        );
    }

    #[test]
    fn single_eligible_seat_wins_without_a_rank() {
        assert_eq!(split_pot(&pot(30, &[1]), &[None, None], 0), vec![(1, 30)]);
    }
}
