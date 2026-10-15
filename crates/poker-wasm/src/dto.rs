//! The data shapes that cross the JavaScript boundary, mirroring the
//! TypeScript types in web/src/core/types.ts, plus conversions to and from the
//! core's own types. Kept separate from the `#[wasm_bindgen]` functions so the
//! conversions can be tested natively with plain `cargo test`.

use poker_core::analysis::{AnalysisOptions, DecisionAnalysis};
use poker_core::engine::{Action, Deck, HandEvent, HandState, LegalActions, Street, TableConfig};
use poker_core::equity::{EquityOptions, EquityResult, Method};
use poker_core::range::{COMBOS, Range};
use poker_core::{Card, CardMask};
use serde::{Deserialize, Serialize};

/// `{ kind: "raise", to: 60 }` and friends.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ActionDto {
    Fold,
    Check,
    Call,
    Bet { amount: u64 },
    Raise { to: u64 },
    AllIn,
}

/// `{ t: "deal", seat: 0, cards: [51, 47] }` and friends. Cards are 0–51,
/// `rank * 4 + suit`, the same encoding on both sides.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "t", rename_all = "camelCase")]
pub enum HandEventDto {
    Deal {
        seat: usize,
        cards: [u8; 2],
    },
    Blind {
        seat: usize,
        amount: u64,
    },
    Act {
        seat: usize,
        action: ActionDto,
    },
    Board {
        cards: Vec<u8>,
    },
    #[serde(rename_all = "camelCase")]
    Award {
        pot_index: usize,
        seat: usize,
        amount: u64,
    },
}

/// The TypeScript `TableConfig`. Seats also carry a `player` (hero or bot
/// profile), which the engine doesn't need, so it is ignored here.
#[derive(Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TableConfigDto {
    pub seats: Vec<SeatDto>,
    pub small_blind: u64,
    pub big_blind: u64,
    pub button: usize,
}

#[derive(Deserialize, Debug, Clone, PartialEq)]
pub struct SeatDto {
    pub stack: u64,
}

/// Everything the UI needs to draw a hand, derived from the events.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HandView {
    pub events: Vec<HandEventDto>,
    pub players: Vec<PlayerView>,
    pub board: Vec<u8>,
    pub street: &'static str,
    /// Chips in the middle not yet awarded.
    pub pot: u64,
    pub current_bet: u64,
    pub to_act: Option<usize>,
    pub legal: Option<LegalView>,
    pub complete: bool,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlayerView {
    pub stack: u64,
    pub street_bet: u64,
    pub total_bet: u64,
    pub folded: bool,
    pub all_in: bool,
    pub hole: Option<[u8; 2]>,
}

#[derive(Serialize, Debug, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LegalView {
    pub seat: usize,
    pub to_call: u64,
    pub call_is_all_in: bool,
    pub min_raise_to: Option<u64>,
    pub max_raise_to: u64,
    pub is_bet: bool,
}

/// Optional overrides; anything left out uses the engine's defaults.
#[derive(Deserialize, Debug, Clone, Copy, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EquityOptionsDto {
    pub budget_ms: Option<f64>,
    pub max_std_err: Option<f64>,
    pub exact_limit: Option<u64>,
    pub max_samples: Option<u64>,
    pub seed: Option<u64>,
}

#[derive(Serialize, Debug, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EquityResultDto {
    pub equity: f64,
    pub win: f64,
    pub tie: f64,
    pub std_err: Option<f64>,
    pub method: &'static str,
    pub evaluations: u64,
    pub live_combos: usize,
}

/// Optional overrides for a decision analysis.
#[derive(Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisOptionsDto {
    pub equity: Option<EquityOptionsDto>,
    pub bet_fractions: Option<Vec<f64>>,
    pub fold_frequency: Option<f64>,
    pub extra_actions: Option<Vec<ActionDto>>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ActionEvDto {
    pub action: ActionDto,
    pub ev: f64,
    pub fold_frequency: Option<f64>,
    pub break_even_fold: Option<f64>,
    pub equity_when_called: Option<f64>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OutsDto {
    pub clean: Vec<u8>,
    pub dirty: Vec<u8>,
    pub unseen: u32,
    pub next_card: f64,
    pub by_river: Option<f64>,
    pub rule_of_thumb: f64,
}

/// The TypeScript `DecisionAnalysis`.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DecisionAnalysisDto {
    pub street: &'static str,
    pub hero: usize,
    pub opponents: usize,
    pub pot: u64,
    pub to_call: u64,
    pub effective_stack: u64,
    pub equity: EquityResultDto,
    pub pot_odds: f64,
    pub mdf: Option<f64>,
    pub spr: f64,
    pub implied_odds_needed: Option<f64>,
    pub outs: Option<OutsDto>,
    pub ev_by_action: Vec<ActionEvDto>,
}

// ---------- Conversions ----------

fn street_name(street: Street) -> &'static str {
    match street {
        Street::Preflop => "preflop",
        Street::Flop => "flop",
        Street::Turn => "turn",
        Street::River => "river",
    }
}

impl From<AnalysisOptionsDto> for AnalysisOptions {
    fn from(o: AnalysisOptionsDto) -> AnalysisOptions {
        let d = AnalysisOptions::default();
        AnalysisOptions {
            equity: o.equity.map(EquityOptions::from).unwrap_or(d.equity),
            bet_fractions: o.bet_fractions.unwrap_or(d.bet_fractions),
            fold_frequency: o.fold_frequency,
            extra_actions: o
                .extra_actions
                .map(|a| a.into_iter().map(Action::from).collect())
                .unwrap_or_default(),
        }
    }
}

impl From<&DecisionAnalysis> for DecisionAnalysisDto {
    fn from(a: &DecisionAnalysis) -> DecisionAnalysisDto {
        let indices = |cards: &[Card]| cards.iter().map(|c| c.index()).collect();
        DecisionAnalysisDto {
            street: street_name(a.street),
            hero: a.hero,
            opponents: a.opponents,
            pot: a.pot,
            to_call: a.to_call,
            effective_stack: a.effective_stack,
            equity: a.equity.into(),
            pot_odds: a.pot_odds,
            mdf: a.mdf,
            spr: a.spr,
            implied_odds_needed: a.implied_odds_needed,
            outs: a.outs.as_ref().map(|o| OutsDto {
                clean: indices(&o.clean),
                dirty: indices(&o.dirty),
                unseen: o.unseen,
                next_card: o.next_card,
                by_river: o.by_river,
                rule_of_thumb: o.rule_of_thumb,
            }),
            ev_by_action: a
                .actions
                .iter()
                .map(|x| ActionEvDto {
                    action: x.action.into(),
                    ev: x.ev,
                    fold_frequency: x.fold_frequency,
                    break_even_fold: x.break_even_fold,
                    equity_when_called: x.equity_when_called,
                })
                .collect(),
        }
    }
}

/// Ranges arrive as one flat array of 1,326 weights per seat, in the order of `seats`.
pub fn seat_ranges(seats: &[u32], weights: &[f32]) -> Result<Vec<(usize, Range)>, String> {
    if weights.len() != seats.len() * COMBOS {
        return Err(format!(
            "expected {} weights for {} ranges, got {}",
            seats.len() * COMBOS,
            seats.len(),
            weights.len()
        ));
    }
    seats
        .iter()
        .zip(weights.chunks(COMBOS))
        .map(|(&seat, w)| {
            Ok((
                seat as usize,
                Range::from_weights(w.to_vec()).map_err(|e| e.to_string())?,
            ))
        })
        .collect()
}

pub fn card(index: u8) -> Result<Card, String> {
    if index < 52 {
        Ok(Card::from_index(index))
    } else {
        Err(format!("card {index} is out of range (0-51)"))
    }
}

pub fn cards(indices: &[u8]) -> Result<Vec<Card>, String> {
    indices.iter().map(|&i| card(i)).collect()
}

pub fn mask(indices: &[u8]) -> Result<CardMask, String> {
    Ok(cards(indices)?.into_iter().collect())
}

fn card_pair(pair: [u8; 2]) -> Result<[Card; 2], String> {
    Ok([card(pair[0])?, card(pair[1])?])
}

fn index_pair(pair: [Card; 2]) -> [u8; 2] {
    [pair[0].index(), pair[1].index()]
}

impl From<ActionDto> for Action {
    fn from(a: ActionDto) -> Action {
        match a {
            ActionDto::Fold => Action::Fold,
            ActionDto::Check => Action::Check,
            ActionDto::Call => Action::Call,
            ActionDto::Bet { amount } => Action::Bet { amount },
            ActionDto::Raise { to } => Action::Raise { to },
            ActionDto::AllIn => Action::AllIn,
        }
    }
}

impl From<Action> for ActionDto {
    fn from(a: Action) -> ActionDto {
        match a {
            Action::Fold => ActionDto::Fold,
            Action::Check => ActionDto::Check,
            Action::Call => ActionDto::Call,
            Action::Bet { amount } => ActionDto::Bet { amount },
            Action::Raise { to } => ActionDto::Raise { to },
            Action::AllIn => ActionDto::AllIn,
        }
    }
}

impl From<&HandEvent> for HandEventDto {
    fn from(e: &HandEvent) -> HandEventDto {
        match e {
            &HandEvent::Blind { seat, amount } => HandEventDto::Blind { seat, amount },
            &HandEvent::Deal { seat, cards } => HandEventDto::Deal {
                seat,
                cards: index_pair(cards),
            },
            &HandEvent::Act { seat, action } => HandEventDto::Act {
                seat,
                action: action.into(),
            },
            HandEvent::Board { cards } => HandEventDto::Board {
                cards: cards.iter().map(|c| c.index()).collect(),
            },
            &HandEvent::Award { pot, seat, amount } => HandEventDto::Award {
                pot_index: pot,
                seat,
                amount,
            },
        }
    }
}

impl TryFrom<&HandEventDto> for HandEvent {
    type Error = String;

    fn try_from(e: &HandEventDto) -> Result<HandEvent, String> {
        Ok(match e {
            &HandEventDto::Blind { seat, amount } => HandEvent::Blind { seat, amount },
            &HandEventDto::Deal { seat, cards } => HandEvent::Deal {
                seat,
                cards: card_pair(cards)?,
            },
            &HandEventDto::Act { seat, action } => HandEvent::Act {
                seat,
                action: action.into(),
            },
            HandEventDto::Board { cards: c } => HandEvent::Board { cards: cards(c)? },
            &HandEventDto::Award {
                pot_index,
                seat,
                amount,
            } => HandEvent::Award {
                pot: pot_index,
                seat,
                amount,
            },
        })
    }
}

impl From<&TableConfigDto> for TableConfig {
    fn from(c: &TableConfigDto) -> TableConfig {
        TableConfig {
            stacks: c.seats.iter().map(|s| s.stack).collect(),
            small_blind: c.small_blind,
            big_blind: c.big_blind,
            button: c.button,
        }
    }
}

impl From<LegalActions> for LegalView {
    fn from(l: LegalActions) -> LegalView {
        LegalView {
            seat: l.seat,
            to_call: l.to_call,
            call_is_all_in: l.call_is_all_in,
            min_raise_to: l.min_raise_to,
            max_raise_to: l.max_raise_to,
            is_bet: l.is_bet,
        }
    }
}

impl From<EquityOptionsDto> for EquityOptions {
    fn from(o: EquityOptionsDto) -> EquityOptions {
        let d = EquityOptions::default();
        EquityOptions {
            budget_ms: o.budget_ms.unwrap_or(d.budget_ms),
            max_std_err: o.max_std_err.unwrap_or(d.max_std_err),
            exact_limit: o.exact_limit.unwrap_or(d.exact_limit),
            max_samples: o.max_samples.unwrap_or(d.max_samples),
            seed: o.seed.unwrap_or(d.seed),
        }
    }
}

impl From<EquityResult> for EquityResultDto {
    fn from(r: EquityResult) -> EquityResultDto {
        EquityResultDto {
            equity: r.equity,
            win: r.win,
            tie: r.tie,
            std_err: r.std_err,
            method: match r.method {
                Method::Exact => "exact",
                Method::MonteCarlo => "montecarlo",
            },
            evaluations: r.evaluations,
            live_combos: r.live_combos,
        }
    }
}

/// Seeds travel as decimal strings: a JavaScript number can't hold every u64 exactly.
pub fn parse_seed(seed: &str) -> Result<u64, String> {
    seed.trim().parse().map_err(|_| {
        format!(
            "seed must be a whole number from 0 to {}, got {seed:?}",
            u64::MAX
        )
    })
}

/// Rebuilds a hand from its config, seed and events.
pub fn replay(
    config: &TableConfigDto,
    seed: &str,
    events: &[HandEventDto],
) -> Result<HandState, String> {
    let events: Vec<HandEvent> = events
        .iter()
        .map(HandEvent::try_from)
        .collect::<Result<_, _>>()?;
    HandState::replay(config.into(), Deck::shuffled(parse_seed(seed)?), &events)
        .map_err(|e| e.to_string())
}

pub fn view(hand: &HandState) -> HandView {
    HandView {
        events: hand.events().iter().map(HandEventDto::from).collect(),
        players: hand
            .players()
            .iter()
            .map(|p| PlayerView {
                stack: p.stack,
                street_bet: p.street_bet,
                total_bet: p.total_bet,
                folded: p.folded,
                all_in: p.is_all_in(),
                hole: p.hole.map(index_pair),
            })
            .collect(),
        board: hand.board().iter().map(|c| c.index()).collect(),
        street: street_name(hand.street()),
        pot: hand.pot(),
        current_bet: hand.current_bet(),
        to_act: hand.to_act(),
        legal: hand.legal_actions().map(LegalView::from),
        complete: hand.is_complete(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn config() -> TableConfigDto {
        serde_json::from_value(json!({
            "seats": [
                { "player": { "kind": "hero" }, "stack": 100 },
                { "player": { "kind": "bot", "profile": "tightPassive" }, "stack": 100 }
            ],
            "smallBlind": 1,
            "bigBlind": 2,
            "button": 0
        }))
        .unwrap()
    }

    #[test]
    fn actions_use_the_typescript_shape() {
        assert_eq!(
            serde_json::to_value(ActionDto::Raise { to: 60 }).unwrap(),
            json!({ "kind": "raise", "to": 60 })
        );
        assert_eq!(
            serde_json::to_value(ActionDto::AllIn).unwrap(),
            json!({ "kind": "allIn" })
        );
        let parsed: ActionDto =
            serde_json::from_value(json!({ "kind": "bet", "amount": 10 })).unwrap();
        assert_eq!(parsed, ActionDto::Bet { amount: 10 });
    }

    #[test]
    fn events_use_the_typescript_shape() {
        let award = HandEventDto::Award {
            pot_index: 1,
            seat: 2,
            amount: 30,
        };
        assert_eq!(
            serde_json::to_value(award).unwrap(),
            json!({ "t": "award", "potIndex": 1, "seat": 2, "amount": 30 })
        );
        let act = HandEventDto::Act {
            seat: 0,
            action: ActionDto::Call,
        };
        assert_eq!(
            serde_json::to_value(act).unwrap(),
            json!({ "t": "act", "seat": 0, "action": { "kind": "call" } })
        );
    }

    #[test]
    fn config_ignores_player_details() {
        let core: TableConfig = (&config()).into();
        assert_eq!(core.stacks, vec![100, 100]);
        assert_eq!((core.small_blind, core.big_blind, core.button), (1, 2, 0));
    }

    #[test]
    fn events_round_trip_through_the_dto_and_replay() {
        let mut hand = HandState::new((&config()).into(), 42).unwrap();
        hand.apply_action(Action::Call).unwrap();
        hand.apply_action(Action::Check).unwrap();

        let dtos = view(&hand).events;
        let json = serde_json::to_string(&dtos).unwrap();
        let back: Vec<HandEventDto> = serde_json::from_str(&json).unwrap();
        let replayed = replay(&config(), "42", &back).unwrap();
        assert_eq!(replayed, hand);
    }

    #[test]
    fn view_reports_turn_and_legal_actions() {
        let hand = HandState::new((&config()).into(), 1).unwrap();
        let v = view(&hand);
        assert_eq!(v.street, "preflop");
        assert_eq!(v.to_act, Some(0));
        assert_eq!(v.pot, 3);
        let legal = v.legal.unwrap();
        assert_eq!(
            (legal.to_call, legal.min_raise_to, legal.is_bet),
            (1, Some(4), false)
        );
        assert!(v.players.iter().all(|p| p.hole.is_some()));
    }

    #[test]
    fn bad_input_is_reported_not_panicked() {
        assert!(card(52).is_err());
        assert!(parse_seed("abc").is_err());
        assert!(parse_seed("-1").is_err());
        assert_eq!(parse_seed("18446744073709551615"), Ok(u64::MAX));
        let bad = [HandEventDto::Deal {
            seat: 0,
            cards: [60, 1],
        }];
        assert!(replay(&config(), "1", &bad).is_err());
    }

    #[test]
    fn analysis_uses_the_typescript_shape() {
        let mut hand = HandState::new((&config()).into(), 42).unwrap();
        hand.apply_action(Action::Call).unwrap();
        let ranges = seat_ranges(&[0], Range::parse("22+, A2s+").unwrap().weights()).unwrap();
        let analysis =
            poker_core::analysis::analyze(&hand, 1, &ranges, &AnalysisOptions::default()).unwrap();
        let json = serde_json::to_value(DecisionAnalysisDto::from(&analysis)).unwrap();
        assert_eq!(json["street"], "preflop");
        assert_eq!(json["toCall"], 0);
        assert_eq!(json["mdf"], serde_json::Value::Null);
        assert_eq!(json["evByAction"][0]["action"], json!({ "kind": "check" }));
        assert!(json["evByAction"][1]["breakEvenFold"].is_number());
    }

    #[test]
    fn seat_ranges_checks_the_length() {
        assert!(seat_ranges(&[1, 2], &vec![0.5; COMBOS * 2]).is_ok());
        assert!(seat_ranges(&[1, 2], &vec![0.5; COMBOS]).is_err());
    }

    #[test]
    fn equity_options_fill_in_defaults() {
        let opts: EquityOptions = EquityOptionsDto {
            budget_ms: Some(20.0),
            ..Default::default()
        }
        .into();
        assert_eq!(opts.budget_ms, 20.0);
        assert_eq!(opts.max_std_err, EquityOptions::default().max_std_err);
    }
}
