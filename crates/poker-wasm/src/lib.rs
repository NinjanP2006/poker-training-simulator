//! The JavaScript API of the poker core, compiled to WebAssembly.
//!
//! The API is deliberately coarse: a few calls that each do a lot of work,
//! because every crossing between JavaScript and WebAssembly has a cost.
//!
//! Hands are stateless on this side. The caller keeps the table config, the
//! deck seed and the event list (plain data it can save as-is); each call
//! rebuilds the hand by replaying the events, which takes microseconds.
//!
//! Errors (illegal actions, bad input) are thrown as JavaScript `Error`s.

pub mod dto;

use std::cell::RefCell;

use dto::{
    ActionDto, AnalysisOptionsDto, DecisionAnalysisDto, EquityOptionsDto, EquityResultDto,
    HandEventDto, TableConfigDto,
};
use poker_core::engine::{Action, HandState};
use poker_core::equity::EquityCache;
use poker_core::eval::fast;
use poker_core::range::Range;
use serde::Serialize;
use serde::de::DeserializeOwned;
use wasm_bindgen::prelude::*;
use web_time::Instant;

thread_local! {
    /// Recent equity results. A Web Worker is single-threaded, so one cache per thread is one cache.
    static EQUITY_CACHE: RefCell<EquityCache> = RefCell::new(EquityCache::new(512));
}

fn from_js<T: DeserializeOwned>(value: JsValue, what: &str) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(value).map_err(|e| JsError::new(&format!("invalid {what}: {e}")))
}

/// Serializes with `None` as `null` (TypeScript's `T | null`), not `undefined`.
fn to_js<T: Serialize>(value: &T) -> Result<JsValue, JsError> {
    let serializer = serde_wasm_bindgen::Serializer::new().serialize_missing_as_null(true);
    value
        .serialize(&serializer)
        .map_err(|e| JsError::new(&e.to_string()))
}

fn js_err(msg: impl AsRef<str>) -> JsError {
    JsError::new(msg.as_ref())
}

/// Builds the evaluator's lookup tables and returns how long that took, in ms.
/// Call once when the worker starts so the first real request is fast.
#[wasm_bindgen(js_name = warmUp)]
pub fn warm_up() -> f64 {
    let start = Instant::now();
    fast::init();
    start.elapsed().as_secs_f64() * 1000.0
}

/// Starts a hand: posts blinds and deals from a deck shuffled with `seed`.
#[wasm_bindgen(js_name = newHand)]
pub fn new_hand(config: JsValue, seed: &str) -> Result<JsValue, JsError> {
    let config: TableConfigDto = from_js(config, "table config")?;
    let seed = dto::parse_seed(seed).map_err(js_err)?;
    let hand = HandState::new((&config).into(), seed).map_err(|e| js_err(e.to_string()))?;
    to_js(&dto::view(&hand))
}

/// Replays a hand and applies the next action. Throws if the action is illegal.
#[wasm_bindgen(js_name = applyAction)]
pub fn apply_action(
    config: JsValue,
    seed: &str,
    events: JsValue,
    action: JsValue,
) -> Result<JsValue, JsError> {
    let mut hand = replay(config, seed, events)?;
    let action: ActionDto = from_js(action, "action")?;
    hand.apply_action(Action::from(action))
        .map_err(|e| js_err(e.to_string()))?;
    to_js(&dto::view(&hand))
}

/// Replays a hand and returns its current view (e.g. after loading a saved hand).
#[wasm_bindgen(js_name = viewHand)]
pub fn view_hand(config: JsValue, seed: &str, events: JsValue) -> Result<JsValue, JsError> {
    to_js(&dto::view(&replay(config, seed, events)?))
}

fn replay(config: JsValue, seed: &str, events: JsValue) -> Result<HandState, JsError> {
    let config: TableConfigDto = from_js(config, "table config")?;
    let events: Vec<HandEventDto> = from_js(events, "events")?;
    dto::replay(&config, seed, &events).map_err(js_err)
}

/// Analyzes hero's current decision: equity, pot odds, MDF, SPR, implied
/// odds, outs and an EV estimate per action. `range_seats[i]` is the seat whose
/// range is `range_weights[i * 1326 .. (i + 1) * 1326]`.
#[wasm_bindgen]
pub fn analyze(
    config: JsValue,
    seed: &str,
    events: JsValue,
    hero_seat: usize,
    range_seats: &[u32],
    range_weights: &[f32],
    options: JsValue,
) -> Result<JsValue, JsError> {
    let hand = replay(config, seed, events)?;
    let ranges = dto::seat_ranges(range_seats, range_weights).map_err(js_err)?;
    let options: AnalysisOptionsDto = if options.is_undefined() || options.is_null() {
        AnalysisOptionsDto::default()
    } else {
        from_js(options, "analysis options")?
    };
    let analysis = poker_core::analysis::analyze(&hand, hero_seat, &ranges, &options.into())
        .map_err(|e| js_err(e.to_string()))?;
    to_js(&DecisionAnalysisDto::from(&analysis))
}

/// Scores 5–7 cards; higher wins. (Returns the packed `HandRank` value.)
#[wasm_bindgen]
pub fn evaluate(cards: &[u8]) -> Result<u32, JsError> {
    let mask = dto::mask(cards).map_err(js_err)?;
    if mask.len() as usize != cards.len() || !(5..=7).contains(&cards.len()) {
        return Err(js_err("evaluate needs 5-7 distinct cards"));
    }
    Ok(fast::eval_mask(mask).value())
}

/// Hero's equity against a range (1,326 weights). Results are cached.
#[wasm_bindgen]
pub fn equity(
    hero: &[u8],
    villain: Vec<f32>,
    board: &[u8],
    dead: &[u8],
    options: JsValue,
) -> Result<JsValue, JsError> {
    let hero: [poker_core::Card; 2] = dto::cards(hero)
        .map_err(js_err)?
        .try_into()
        .map_err(|_| js_err("hero needs exactly 2 cards"))?;
    let villain = Range::from_weights(villain).map_err(|e| js_err(e.to_string()))?;
    let board = dto::cards(board).map_err(js_err)?;
    let dead = dto::mask(dead).map_err(js_err)?;
    let options: EquityOptionsDto = if options.is_undefined() || options.is_null() {
        EquityOptionsDto::default()
    } else {
        from_js(options, "equity options")?
    };

    let result = EQUITY_CACHE
        .with(|cache| {
            cache
                .borrow_mut()
                .equity(hero, &villain, &board, dead, &options.into())
        })
        .map_err(|e| js_err(e.to_string()))?;
    to_js(&EquityResultDto::from(result))
}

/// Hand strength (0–1) for all 1,326 combos on a 3–5 card board: the share of
/// other hands each beats, averaged over the next card. 0 for blocked combos.
#[wasm_bindgen(js_name = comboStrengths)]
pub fn combo_strengths(board: &[u8], dead: &[u8]) -> Result<Vec<f32>, JsError> {
    let board = dto::cards(board).map_err(js_err)?;
    let dead = dto::mask(dead).map_err(js_err)?;
    poker_core::strength::combo_strengths(&board, dead).map_err(|e| js_err(e.to_string()))
}

/// Parses range notation like "22+, A2s+, 0.5(KQo)" into 1,326 weights.
#[wasm_bindgen(js_name = parseRange)]
pub fn parse_range(notation: &str) -> Result<Vec<f32>, JsError> {
    Range::parse(notation)
        .map(|r| r.weights().to_vec())
        .map_err(|e| js_err(e.to_string()))
}

/// The canonical notation for 1,326 weights.
#[wasm_bindgen(js_name = rangeToNotation)]
pub fn range_to_notation(weights: Vec<f32>) -> Result<String, JsError> {
    Range::from_weights(weights)
        .map(|r| r.to_notation())
        .map_err(|e| js_err(e.to_string()))
}

/// Measures 7-card evaluations per second in this environment (the plan's
/// "WASM within 2x of native" check), over `hands` pseudo-random hands.
#[wasm_bindgen(js_name = evalThroughput)]
pub fn eval_throughput(hands: u32) -> f64 {
    fast::init();
    let mut state: u64 = 0x9E37_79B9_7F4A_7C15;
    let masks: Vec<poker_core::CardMask> = (0..hands.max(1))
        .map(|_| {
            let mut m = poker_core::CardMask::empty();
            while m.len() < 7 {
                state ^= state << 13;
                state ^= state >> 7;
                state ^= state << 17;
                m.insert(poker_core::Card::from_index((state % 52) as u8));
            }
            m
        })
        .collect();

    let start = Instant::now();
    let mut checksum = 0u32;
    let rounds = 10;
    for _ in 0..rounds {
        for &m in &masks {
            checksum ^= fast::eval_mask(m).value();
        }
    }
    let secs = start.elapsed().as_secs_f64().max(1e-9);
    std::hint::black_box(checksum);
    (masks.len() * rounds) as f64 / secs
}
