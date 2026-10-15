//! Checks the Rust formulas against fixtures/formulas.json, the same cases
//! the TypeScript formulas are tested against.

use poker_core::math;
use serde_json::Value;

const FIXTURES: &str = include_str!("../../../fixtures/formulas.json");

/// Calls the named formula with JSON arguments. `None` means the formula
/// returned "no answer" (only `impliedOdds` does).
fn call(name: &str, args: &[f64]) -> Option<f64> {
    let int = |i: usize| args[i] as u64;
    Some(match name {
        "potOdds" => math::pot_odds(args[0], args[1]),
        "equity" => math::equity(args[0], args[1], args[2]),
        "evCall" => math::ev_call(args[0], args[1], args[2]),
        "evBet" => math::ev_bet(args[0], args[1], args[2], args[3]),
        "bluffBreakEven" => math::bluff_break_even(args[0], args[1]),
        "mdf" => math::mdf(args[0], args[1]),
        "impliedOdds" => return math::implied_odds(args[0], args[1], args[2]),
        "choose" => math::choose(int(0), int(1)) as f64,
        "outs" => math::outs(int(0), int(1)),
        "spr" => math::spr(args[0], args[1]),
        "pairCombos" => math::pair_combos(int(0)) as f64,
        "unpairedCombos" => math::unpaired_combos(int(0), int(1)) as f64,
        other => panic!("fixtures name an unknown formula {other:?}; add it here and in math.rs"),
    })
}

#[test]
fn every_formula_matches_the_shared_fixtures() {
    let fixtures: serde_json::Map<String, Value> = serde_json::from_str(FIXTURES).unwrap();
    let mut checked = 0;
    for (name, cases) in fixtures.iter().filter(|(k, _)| !k.starts_with('_')) {
        for case in cases.as_array().unwrap() {
            let args: Vec<f64> = case["args"]
                .as_array()
                .unwrap()
                .iter()
                .map(|a| a.as_f64().unwrap())
                .collect();
            let got = call(name, &args);
            let note = case.get("note").and_then(Value::as_str).unwrap_or("");
            match case["expected"].as_f64() {
                None => assert_eq!(got, None, "{name}{args:?} ({note})"),
                Some(expected) => {
                    let got = got.unwrap_or_else(|| panic!("{name}{args:?} returned no answer"));
                    // Expected values are rounded to 6 decimal places in the file.
                    assert!(
                        (got - expected).abs() < 1e-5,
                        "{name}{args:?} = {got}, expected {expected} ({note})"
                    );
                }
            }
            checked += 1;
        }
    }
    assert!(checked >= 25, "only {checked} cases found");
}
