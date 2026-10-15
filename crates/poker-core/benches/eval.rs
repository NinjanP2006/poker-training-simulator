//! Hand evaluator throughput. Run with `cargo bench -p poker-core`.
//! Criterion reports "thrpt" in elements per second; one element = one hand.

use std::hint::black_box;

use criterion::{Criterion, Throughput, criterion_group, criterion_main};
use poker_core::eval::{fast, naive};
use poker_core::{Card, CardMask};

const HANDS: usize = 10_000;

/// Deterministic random 7-card hands (xorshift64), so every run measures the same input.
fn random_hands(count: usize) -> Vec<CardMask> {
    let mut state: u64 = 0x9E37_79B9_7F4A_7C15;
    let mut hands = Vec::with_capacity(count);
    while hands.len() < count {
        let mut hand = CardMask::empty();
        while hand.len() < 7 {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            hand.insert(Card::from_index((state % 52) as u8));
        }
        hands.push(hand);
    }
    hands
}

fn eval7(c: &mut Criterion) {
    fast::init(); // build tables outside the timed loop
    let hands = random_hands(HANDS);
    let hand_vecs: Vec<Vec<Card>> = hands.iter().map(|h| h.iter().collect()).collect();

    let mut group = c.benchmark_group("eval7");
    group.throughput(Throughput::Elements(HANDS as u64));

    group.bench_function("fast", |b| {
        b.iter(|| {
            let mut acc = 0u32;
            for &hand in &hands {
                acc ^= fast::eval_mask(black_box(hand)).value();
            }
            acc
        })
    });

    group.sample_size(20); // the naive evaluator is slow; fewer samples keep the run short
    group.bench_function("naive", |b| {
        b.iter(|| {
            let mut acc = 0u32;
            for hand in &hand_vecs {
                acc ^= naive::eval(black_box(hand)).value();
            }
            acc
        })
    });

    group.finish();
}

criterion_group!(benches, eval7);
criterion_main!(benches);
