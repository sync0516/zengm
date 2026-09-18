# Reproduce the full-season simulation benchmark

This optional harness is separate from the simulation PR. Keep its three executable files at these paths in each checkout being measured:

```text
work/all-sport-bench/run.cjs
work/all-sport-bench/vitest.config.ts
work/all-sport-bench/season.test.browser.ts
```

The config and browser test are the same files used for the PR comparison. The portable runner launches that test, saves its output, and optionally compares a reference result. It does not switch Git revisions or modify simulation source. Use separate clean checkouts for the two revisions and copy this directory into both.

[Recorded results](results.json) contains both repeats for every sport, all 16 raw result records, and the checked commit/tree IDs. The original optimized runs used a local commit with the same complete source tree as the published PR commit. The portable runner was also exercised on the published PR source and matched the upstream basketball reference.

## Revisions and dependencies

The PR comparison uses:

- Upstream baseline: `8d979c3d37750ea244e0760ab7cc8db6c965f23c` in `zengm-games/zengm`.
- Optimized: `fe241901f69249e98b2988f196503ba7db41dee5` on `sync0516/zengm`, branch `perf/all-sports-simulation`.
- Optimized source tree: `559a331fb6eae64f7b67a38d45878b2c12b8f310` (identical trees can have different commit IDs).

Use Node.js **24.13.0** and pnpm **11.19.0**, with each revision's committed `pnpm-lock.yaml`. The lockfile pins Vitest **5.0.1**, Playwright **1.63.0**, and its Chromium **153.0.8010.12** browser revision **1243**. Install the browser through Playwright; do not select a system Chrome channel.

With nvm, select the exact Node version using `nvm install 24.13.0` followed by `nvm use 24.13.0` (or install that version through your usual Node manager). Then run the following in **each checkout root**:

```sh
node --version
npm install --global pnpm@11.19.0
pnpm --version
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
node --run pre-test
```

On Linux, Playwright may additionally need system libraries: `pnpm exec playwright install --with-deps chromium`. Do not update dependencies between compared runs. Check out source with `git checkout --detach REVISION`; fetch the fork revision first if it is not available locally. The runner requires a clean `src` tree and records the checkout's commit and tree IDs.

## Run one sport

From the checkout root:

```sh
node work/all-sport-bench/run.cjs basketball upstream-1 3 1 12345
```

Arguments are `SPORT LABEL [SEASONS] [WARMUP] [SEED] [REFERENCE_JSON]`. Defaults are three measured seasons, one warmup season, and seed 12345. Supported sports are `basketball`, `football`, `baseball`, and `hockey`.

With football, the runner copies `data/real-schedules.football.json` to `public/gen/real-schedules.json` before launching the test. This is required for the football schedule loader. Changing the first argument also sets `SPORT` for the build plugin and browser test; no source edits are needed.

Each run writes `work/all-sport-bench/results/SPORT-LABEL.log` and `.json`. A repeated label overwrites those files. To require the same outcome as a completed run in another checkout, supply its result path:

```sh
node work/all-sport-bench/run.cjs basketball optimized-1 3 1 12345 ../zengm-upstream/work/all-sport-bench/results/basketball-upstream-1.json
```

The reference path is relative to your current working directory. Any difference in the compared result fields causes a nonzero exit. The test log remains available for diagnosis.

The same options can be supplied through environment variables when their positional arguments are omitted:

| Variable | Default | Meaning |
| --- | --- | --- |
| `SPORT` | `basketball` | Sport to compile and simulate |
| `BENCH_LABEL` | `baseline` | Output label |
| `BENCH_SEASONS` | `3` | Measured seasons |
| `BENCH_WARMUP` | `1` | Unmeasured seasons before timing |
| `BENCH_SEED` | `12345` | Unsigned 32-bit random seed |
| `BENCH_REFERENCE` | Unset | Result JSON to compare |
| `BENCH_PROFILE` | `0` | Set `1` for the existing Chromium CPU profile output |

Keep profiling disabled for time comparisons. Profiles are written under `work/all-sport-bench/profile-SPORT-LABEL.json`.

## Comparison order and measurement scope

For each sport, run serially in this order: **upstream-1, optimized-1, optimized-2, upstream-2**. Pass upstream-1's result as the reference for the remaining three runs. Use identical seed, seasons, warmup, dependencies, browser, and machine conditions. Compare the mean of the two upstream times with the mean of the two optimized times. Avoid concurrent games, builds, and other CPU-heavy tasks; small timing differences need repeat measurements.

The browser test creates a fresh default fictional league starting in 2016. It simulates the warmup, flushes persistence, then times autoplay from preseason to preseason for the requested number of seasons, including the final cache flush. With the PR settings, the measured interval is preseason 2017 through preseason 2020. The timer includes games, playoffs, drafts, free agency, player development, awards, and persistence. It excludes process/browser startup, dependency transforms, league creation, warmup, result hashing, and cleanup. This is headless Chromium running the worker code in the test environment; normal UI rendering and live play-by-play are outside this benchmark.

## What equivalence checks establish

The runner compares sport/settings, random-call counts and generator state, game counts, a score checksum, and SHA-256 hashes of the JSON rows from 22 persisted league stores. It also verifies that autoplay reaches the expected preseason and plays games. `games`, the score checksum, and final random counters cover creation/warmup plus the measured interval where applicable; `measuredGames` excludes warmup games. Initial random counters/state are captured after creation, before warmup.

Stores checked: players, teams, teamSeasons, teamStats, awards, playoffSeries, games, allStars, draftLotteryResults, draftPicks, events, headToHeads, messages, negotiations, playerFeats, releasedPlayers, schedule, seasonLeaders, trade, scheduledEvents, savedTrades, and savedTradingBlock.

`gameAttributes` and the separate meta database are not hashed. JSON serialization also does not distinguish undefined properties from missing properties, negative zero from zero, or nonfinite numbers from null. Matching results therefore mean the checked JSON data and random sequence counters/state match for these seeded runs; they are not a proof of every internal state or every custom-league setting. Targeted source tests provide additional edge-case coverage.
