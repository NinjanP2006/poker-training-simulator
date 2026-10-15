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

criterion_group!(benches, equity_benches);
criterion_main!(benches);
