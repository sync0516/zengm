# Simulation performance after review

Comparison for PR #543 against upstream master `95f81fe379458a463bb18cef85da9a492093493f`. This baseline already includes the optimizations adopted upstream before this revision. These results measure the remaining combined change.

- Published PR commit: `ec54f295b39a58d88b6f2532dea0d241ceb0a169`
- Measured source tree: `b43714e036c872a2d1fac0d3591dd8632c2e6663`
- The local measurement commits recorded in `results.json` and the published PR commit have identical complete Git trees. A local amendment changed commit metadata without changing the tree, and publication used the GitHub API. Every raw record retains its original commit and tree identifiers.
- Environment: Ryzen 5 7600X, Windows, Node 24.13.0, Chromium through the lockfile's Playwright version. Dependencies installed using `pnpm install --frozen-lockfile`.

## Workload and results

| Sport | Upstream runs (s) | PR runs (s) | Means (s) | Less elapsed time |
|---|---:|---:|---:|---:|
| Basketball | 12.81 / 12.75 | 10.60 / 10.48 | 12.78 → 10.54 | 17.5% |
| Football | 23.05 / 23.61 | 20.29 / 20.06 | 23.33 → 20.18 | 13.5% |
| Baseball | 37.46 / 37.15 | 33.84 / 33.80 | 37.31 → 33.82 | 9.3% |
| Hockey | 29.00 / 28.75 | 17.49 / 17.34 | 28.87 → 17.42 | 39.7% |

Each row contains two runs per revision: upstream, candidate, candidate, upstream, executed serially. Each run creates a fresh generated league with seed 12345, warms up one season, then measures three complete seasons. Timing includes games, playoffs, offseason processing and final saving. Creation, warmup and verification are excluded. Results depend on hardware, league settings/history and background activity.

`results.json` contains all 16 timing records and eight additional history-check records. The latter compare two measured seasons after six warmup seasons, seed 98765, once per sport/revision. Their times are retained as raw observations, not used in the headline performance table.

All comparisons matched random-call counts and states, game counts, score checksums, and SHA-256 hashes of JSON-serialized records in 22 persisted tables. These include players, teams, statistics, games, awards, playoffs, draft picks and transactions. Runtime metadata and game attributes are excluded. JSON normalizes special numeric/undefined values; direct regression tests cover relevant edge cases separately. Equivalence applies to these tested scenarios.

## Reproduce

Use Node 24 and pnpm 11. Create clean checkouts of the baseline and published PR commit. Copy this directory into `work/all-sport-bench` in each checkout; do not replace its `src`, dependency files or root Vitest configuration. Install dependencies, ensure Chromium is available, and generate test assets in each:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
node tools/pre-test.ts
```

From the baseline checkout:

```sh
node work/all-sport-bench/run.cjs football upstream-1 3 1 12345
```

From the candidate checkout, supplying the absolute path to that first result:

```sh
node work/all-sport-bench/run.cjs football revised-1 3 1 12345 /path/to/baseline/work/all-sport-bench/results/football-upstream-1.json
node work/all-sport-bench/run.cjs football revised-2 3 1 12345 /path/to/baseline/work/all-sport-bench/results/football-upstream-1.json
```

Then repeat the baseline with label `upstream-2` and the same reference. Repeat the full sequence for `basketball`, `baseball`, and `hockey`, using the matching sport's reference. Each result and complete Vitest log is saved under `work/all-sport-bench/results`. The runner rejects uncommitted source changes and fails if any checked simulation data differ.

For history checks, use arguments `SPORT history-upstream 2 6 98765` in baseline and `SPORT history-revised 2 6 98765 REFERENCE_JSON` in candidate.

## Football stats-planning audit

The removed football-only `compileStats` path was also tested separately on the merged review code, changing only `src/common/processPlayerStats.football.ts` and `src/worker/db/getCopies/playersPlus.ts`. The order was ON/OFF/OFF/ON, five measured seasons after one warmup, seed 12345. All checked simulation data matched.

| Variant | Runs (s) | Mean (s) |
|---|---:|---:|
| ON | 34.6086 / 34.6853 | 34.64695 |
| OFF | 35.2838 / 35.7177 | 35.50075 |

This is a measured 2.405% local gain, not evidence of no gain. The final PR removes that path: the modest benefit did not justify a separate football projection implementation or expanding four mature projection APIs in this PR. General regression tests remain. This audit predates only the removal and test cleanup; per-run source fingerprints document its exact inputs.

`stats-audit` contains all four raw results/logs and source fingerprints. `review-stats-variants` contains immutable ON/OFF sources and hashes. To rerun the isolated experiment in a disposable candidate checkout:

```sh
node work/all-sport-bench/review-stats-audit.cjs . work/all-sport-bench/results/stats-recheck recheck
```

The wrapper swaps only the two recognized runtime modules, checks other source/configuration inputs before and after each run, and restores the original bytes on normal completion or caught errors. Do not edit sources or run tests/builds concurrently. A hard termination can interrupt restoration; the variant files remain available.

## Validation

489 tests passed, 12 skipped; TypeScript, full ESLint and all four production builds passed. Test coverage includes current fatigue/injury state and selection identity/order, exact prepared-roster arithmetic, depth edits and ties, stat totals, live events, bench recovery and free-agent weighted selection. The scratch benchmark directory was outside the checkout during full typechecking so it was not mistaken for application source.

The benchmark files and raw records are published separately from the PR's application changes.
