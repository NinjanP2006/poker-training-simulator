# Equity benchmark: 200 spots

`spots.tsv` holds 200 hand-vs-range equity spots (67 flop, 67 turn, 66 river;
every eighth spot has two dead cards) with reference equities computed by
[eval7](https://pypi.org/project/eval7/) 0.1.10, an independent open-source
poker library. None of this project's code is involved in producing them.

The engine is checked against this file in
`crates/poker-core/tests/equity_benchmark.rs`:

| Check | Bar | Result |
|---|---|---|
| Range parser vs eval7's parser (weighted combo counts) | exact | all 200 match |
| Exact enumeration vs eval7 | within 0.1 percentage points | largest difference 5.0e-7 |
| Monte Carlo 95% intervals contain the eval7 value | about 95% of spots | 191 / 200 (95.5%) |

Run it:

```sh
cargo test --release -p poker-core --test equity_benchmark -- --include-ignored --nocapture
```

Regenerate the reference values (see the setup notes at the top of the script):

```sh
python generate_reference.py > spots.tsv
```
