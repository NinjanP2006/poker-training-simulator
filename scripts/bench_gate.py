"""Fail CI if any Criterion benchmark got more than THRESHOLD slower.

Criterion writes, for each benchmark compared against a saved baseline,
target/criterion/<name>/change/estimates.json, whose "mean" holds the relative
change in run time (0.12 = 12% slower) with a confidence interval.

A benchmark fails only if its whole 95% confidence interval is above the
threshold, i.e. it is clearly more than THRESHOLD slower. Shared CI machines
are noisy (tiny benchmarks swing several percent between identical runs), so
judging by the point estimate alone would fail builds at random.

Usage: python3 scripts/bench_gate.py target/criterion 0.10
"""

import json
import pathlib
import sys


def main():
    root = pathlib.Path(sys.argv[1])
    threshold = float(sys.argv[2])
    changes = sorted(root.glob("**/change/estimates.json"))
    if not changes:
        print("No baseline comparisons found; nothing to check.")
        return 0

    failed = []
    for path in changes:
        name = path.parent.parent.relative_to(root).as_posix()
        mean = json.loads(path.read_text())["mean"]
        change = mean["point_estimate"]
        low = mean["confidence_interval"]["lower_bound"]
        status = "ok"
        if low > threshold:
            status = "REGRESSION"
            failed.append(name)
        print(f"{status:>10}  {change:+7.1%}  {name}")

    if failed:
        print(f"\n{len(failed)} benchmark(s) more than {threshold:.0%} slower: {', '.join(failed)}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
