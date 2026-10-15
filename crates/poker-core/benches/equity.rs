//! Equity calculation speed for typical math-panel requests.
//! Run with `cargo bench -p poker-core --bench equity`.

use std::hint::black_box;

use criterion::{Criterion, criterion_group, criterion_main};
use poker_core::equity::{EquityOptions, equity};
use poker_core::eval::fast;
use poker_core::range::Range;
use poker_core::{Card, CardMask};

fn cards(s: &str) -> Vec<Card> {
    s.split_whitespace().map(|c| c.parse().unwrap()).collect()
}

fn bench_spot(
    c: &mut Criterion,
    name: &str,
    hero: &str,
    villain: &str,
    board: &str,
    opts: EquityOptions,
) {
    let hero: [Card; 2] = cards(hero).try_into().unwrap();
    let villain = Range::parse(villain).unwrap();
    let board = cards(board);
    c.bench_function(name, |b| {
        b.iter(|| equity(black_box(hero), &villain, &board, CardMask::empty(), &opts).unwrap())
    });
}

fn equity_benches(c: &mut Criterion) {
    fast::init();
    let exact = EquityOptions::default();
    let typical = "22+, A2s+, KTo+, QJs"; // 166 combos
    let wide = "22+, A2s+, A2o+, K2s+, K8o+, Q8s+, QTo+, J8s+, JTo, T8s+, 97s+, 87s, 76s"; // 462 combos

    bench_spot(
        c,
        "equity/river_exact",
        "As Kd",
        typical,
        "Ts 9h 2c 7d 3s",
        exact,
    );
    bench_spot(
        c,
        "equity/turn_exact",
        "As Kd",
        typical,
        "Ts 9h 2c 7d",
        exact,
    );
    bench_spot(c, "equity/flop_exact", "As Kd", typical, "Ts 9h 2c", exact);
    bench_spot(
        c,
        "equity/flop_exact_wide_range",
        "As Kd",
        wide,
        "Ts 9h 2c",
        exact,
    );

    // Preflop always samples. A fixed sample count keeps the workload identical run to run.
    let fixed_mc = EquityOptions {
        max_samples: 20_000,
        max_std_err: 0.0,
        budget_ms: f64::INFINITY,
        ..EquityOptions::default()
    };
    bench_spot(
        c,
        "equity/preflop_mc_20k_samples",
        "As Kd",
        typical,
        "",
        fixed_mc,
    );
}

/// A full decision analysis (equity per combo, outs, EV of every action),
/// facing a flop bet and preflop.
fn analysis_benches(c: &mut Criterion) {
    use poker_core::analysis::{AnalysisOptions, analyze};
    use poker_core::engine::{Action, Deck, HandState, TableConfig};

    fast::init();
    let config = TableConfig {
        stacks: vec![1000, 1000],
        small_blind: 1,
        big_blind: 2,
        button: 0,
    };
    let deck = Deck::stacked(&cards("Qs Qd Ah Kh Qh 7h 2c"));
    let preflop = HandState::with_deck(config, deck).unwrap();
    let mut flop = preflop.clone();
    for action in [
        Action::Raise { to: 6 },
        Action::Call,
        Action::Bet { amount: 8 },
    ] {
        flop.apply_action(action).unwrap();
    }
    let ranges = [(1, Range::parse("22+, A2s+, KTo+, QJs").unwrap())];
    let opts = AnalysisOptions::default();

    c.bench_function("analysis/flop_facing_bet", |b| {
        b.iter(|| analyze(black_box(&flop), 0, &ranges, &opts).unwrap())
    });
    c.bench_function("analysis/preflop", |b| {
        b.iter(|| analyze(black_box(&preflop), 0, &ranges, &opts).unwrap())
    });
}

criterion_group!(benches, equity_benches, analysis_benches);
criterion_main!(benches);
