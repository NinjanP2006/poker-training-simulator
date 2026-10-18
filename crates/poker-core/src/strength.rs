//! Hand strength for every combo on a board at once: a cheap, comparable
//! score that bots bucket their hands by, and that range narrowing applies to
//! all 1,326 combos (which full equity per combo would make far too slow).

use crate::card::Card;
use crate::equity::EquityError;
use crate::eval::{HandRank, fast};
use crate::mask::CardMask;
use crate::range::{COMBOS, combo_mask};

/// For each combo: the share of other hands it beats on this board (ties
/// count half), averaged over every possible next card while cards are still
/// to come, so draws get partial credit. Combos that use a board or dead card
/// get 0. The board must have 3–5 cards.
///
/// This is the classic "hand strength" percentile from poker AI. It ignores
/// card removal between the two hands (a shift of well under a percent), which
/// turns an all-pairs comparison into one sort per board.
pub fn combo_strengths(board: &[Card], dead: CardMask) -> Result<Vec<f32>, EquityError> {
    if !(3..=5).contains(&board.len()) {
        return Err(EquityError::BadBoard(board.len()));
    }
    let board_mask: CardMask = board.iter().copied().collect();
    if board_mask.len() as usize != board.len() || board_mask.intersects(dead) {
        return Err(EquityError::DuplicateCards);
    }
    let known = board_mask.union(dead);

    let mut sum = vec![0.0f64; COMBOS];
    let mut count = vec![0u32; COMBOS];
    if board.len() == 5 {
        add_percentiles(board_mask, known, &mut sum, &mut count);
    } else {
        for card in CardMask::FULL_DECK.iter().filter(|&c| !known.contains(c)) {
            let mut next = board_mask;
            next.insert(card);
            let mut excluded = known;
            excluded.insert(card);
            add_percentiles(next, excluded, &mut sum, &mut count);
        }
    }

    Ok((0..COMBOS)
        .map(|i| {
            if count[i] == 0 {
                0.0
            } else {
                (sum[i] / count[i] as f64) as f32
            }
        })
        .collect())
}

/// Ranks every combo not touching `excluded` on `board` and adds each one's
/// percentile (share of the others it beats, ties as half) to `sum`.
fn add_percentiles(board: CardMask, excluded: CardMask, sum: &mut [f64], count: &mut [u32]) {
    let mut ranked: Vec<(HandRank, usize)> = (0..COMBOS)
        .filter(|&i| !combo_mask(i).intersects(excluded))
        .map(|i| (fast::eval_mask(combo_mask(i).union(board)), i))
        .collect();
    ranked.sort_unstable();

    let others = (ranked.len() - 1) as f64;
    let mut start = 0;
    while start < ranked.len() {
        let end = start
            + ranked[start..]
                .iter()
                .take_while(|(r, _)| *r == ranked[start].0)
                .count();
        let tied_with = (end - start - 1) as f64;
        let percentile = (start as f64 + 0.5 * tied_with) / others;
        for &(_, i) in &ranked[start..end] {
            sum[i] += percentile;
            count[i] += 1;
        }
        start = end;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::range::combo_index;

    fn cards(s: &str) -> Vec<Card> {
        s.split_whitespace().map(|c| c.parse().unwrap()).collect()
    }

    fn strength(all: &[f32], hand: &str) -> f32 {
        let c = cards(hand);
        all[combo_index(c[0], c[1])]
    }

    #[test]
    fn river_strength_orders_made_hands() {
        // No straight or flush is possible on this board.
        let s = combo_strengths(&cards("2c 7d 9h Ks 3c"), CardMask::empty()).unwrap();
        assert!(strength(&s, "Kd Kh") > 0.99, "top set");
        assert!(
            strength(&s, "Ad Kc") > strength(&s, "Qd Qc"),
            "top pair beats an underpair"
        );
        assert!(strength(&s, "Qd Qc") > strength(&s, "8d 8c"));
        assert!(strength(&s, "5h 4h") < 0.15, "five-high");
        assert_eq!(strength(&s, "Ks Ah"), 0.0, "uses a board card");
        assert!(s.iter().all(|&x| (0.0..=1.0).contains(&x)));
    }

    #[test]
    fn draws_get_partial_credit_on_the_flop() {
        let s = combo_strengths(&cards("Ah 7h 2c"), CardMask::empty()).unwrap();
        let flush_draw = strength(&s, "Kh Qh");
        let no_draw = strength(&s, "Kd Qc");
        assert!(flush_draw > no_draw + 0.05, "{flush_draw} vs {no_draw}");
        assert!(strength(&s, "Ad Ac") > 0.97, "top set");
    }

    #[test]
    fn dead_cards_are_excluded() {
        let dead: CardMask = cards("Kd Kh").into_iter().collect();
        let s = combo_strengths(&cards("2c 7d 9h Ks 3c"), dead).unwrap();
        assert_eq!(strength(&s, "Kd Kh"), 0.0);
        assert!(strength(&s, "Kc Ah") > 0.9);
    }

    #[test]
    fn rejects_bad_boards() {
        assert_eq!(
            combo_strengths(&cards("2c 7d"), CardMask::empty()),
            Err(EquityError::BadBoard(2))
        );
        assert_eq!(
            combo_strengths(&cards("2c 2c 7d"), CardMask::empty()),
            Err(EquityError::DuplicateCards)
        );
        let dead: CardMask = cards("2c").into_iter().collect();
        assert_eq!(
            combo_strengths(&cards("2c 3d 7d"), dead),
            Err(EquityError::DuplicateCards)
        );
    }
}
