//! The 200-spot equity benchmark (bench/spots/spots.tsv). Reference values
//! come from eval7, an independent open-source poker library; see
//! bench/spots/generate_reference.py for how they were produced.

use poker_core::equity::{EquityOptions, Method, equity};
use poker_core::range::Range;
use poker_core::{Card, CardMask};

const SPOTS_TSV: &str = include_str!("../../../bench/spots/spots.tsv");

/// The plan's accuracy bar for exact enumeration: within 0.1 percentage points.
const EXACT_TOLERANCE: f64 = 0.001;

struct Spot {
    line: usize,
    hero: [Card; 2],
    board: Vec<Card>,
    dead: CardMask,
    notation: String,
    villain: Range,
    eval7_combos: f64,
    reference: f64,
}

fn cards(s: &str) -> Vec<Card> {
    if s == "-" {
        return Vec::new();
    }
    s.split_whitespace().map(|c| c.parse().unwrap()).collect()
}

fn spots() -> Vec<Spot> {
    SPOTS_TSV
        .lines()
        .enumerate()
        .filter(|(_, l)| !l.starts_with('#') && !l.trim().is_empty())
        .map(|(i, line)| {
            let f: Vec<&str> = line.split('\t').collect();
            assert_eq!(f.len(), 6, "line {}: expected 6 columns", i + 1);
            Spot {
                line: i + 1,
                hero: cards(f[0]).try_into().unwrap(),
                board: cards(f[1]),
                dead: cards(f[2]).into_iter().collect(),
                notation: f[3].to_string(),
                villain: Range::parse(f[3]).unwrap_or_else(|e| panic!("line {}: {e}", i + 1)),
                eval7_combos: f[4].parse().unwrap(),
                reference: f[5].parse().unwrap(),
            }
        })
        .collect()
}

#[test]
fn benchmark_has_200_spots_and_every_range_matches_eval7s_parser() {
    let spots = spots();
    assert_eq!(spots.len(), 200);
    for s in &spots {
        // Weights are f32, so allow for rounding in the weighted totals.
        assert!(
            (s.villain.combo_count() - s.eval7_combos).abs() < 1e-3,
            "line {}: {:?} parses to {} combos here, {} in eval7",
            s.line,
            s.notation,
            s.villain.combo_count(),
            s.eval7_combos
        );
    }
}

fn check_exact(spots: &[&Spot]) {
    let opts = EquityOptions::default();
    let mut worst: f64 = 0.0;
    for s in spots {
        let r = equity(s.hero, &s.villain, &s.board, s.dead, &opts)
            .unwrap_or_else(|e| panic!("line {}: {e}", s.line));
        assert_eq!(
            r.method,
            Method::Exact,
            "line {}: expected exact enumeration",
            s.line
        );
        let diff = (r.equity - s.reference).abs();
        assert!(
            diff <= EXACT_TOLERANCE,
            "line {}: equity {:.6} vs eval7 {:.6} ({} vs {:?} on {:?})",
            s.line,
            r.equity,
            s.reference,
            s.hero.map(|c| c.to_string()).join(""),
            s.notation,
            s.board.iter().map(|c| c.to_string()).collect::<String>(),
        );
        worst = worst.max(diff);
    }
    println!(
        "{} spots, largest difference from eval7: {worst:.2e}",
        spots.len()
    );
}

/// Every 10th spot, so the default (debug) test run stays quick.
#[test]
fn exact_equity_matches_eval7_on_a_sample() {
    let spots = spots();
    check_exact(&spots.iter().step_by(10).collect::<Vec<_>>());
}

/// All 200 spots. Run in release: `cargo test --release -- --ignored` (CI does).
#[test]
#[ignore]
fn exact_equity_matches_eval7_on_all_200_spots() {
    let spots = spots();
    check_exact(&spots.iter().collect::<Vec<_>>());
}

/// Forces Monte Carlo on every spot and checks its reported uncertainty is
/// honest: the true (eval7) value should fall inside the 95% interval
/// (± 1.96 standard errors) about 95% of the time.
#[test]
#[ignore]
fn monte_carlo_95_percent_intervals_cover_the_reference() {
    let spots = spots();
    let mut covered = 0;
    for (i, s) in spots.iter().enumerate() {
        let opts = EquityOptions {
            exact_limit: 0,
            max_std_err: 0.0,
            max_samples: 20_000,
            budget_ms: f64::INFINITY,
            seed: i as u64,
            ..EquityOptions::default()
        };
        let r = equity(s.hero, &s.villain, &s.board, s.dead, &opts).unwrap();
        let se = r.std_err.unwrap();
        // A spot with zero variance (always win or always lose) has se = 0:
        // then the estimate must be exactly right.
        if (r.equity - s.reference).abs() <= 1.96 * se + 1e-9 {
            covered += 1;
        }
    }
    let coverage = covered as f64 / spots.len() as f64;
    println!(
        "95% interval covered the reference in {covered}/{} spots ({:.1}%)",
        spots.len(),
        coverage * 100.0
    );
    // With 200 spots, honest intervals land within about ±3 points of 95%.
    assert!((0.91..=0.99).contains(&coverage), "coverage {coverage:.3}");
}
