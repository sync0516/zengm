# Basketball late-game non-shooting fouls

## Result

Implemented locally on `fix/basketball-late-fouls`, based on upstream
`56810b0bdd7911912cd326aa0db14e8e3197a6f5`.

Halve the ordinary non-shooting foul check from 8% to 4%, before applying the
league foul-rate setting, only when:

- the game is in its final regulation period or overtime;
- 60 seconds or less remain;
- the defense is tied or ahead by one or two points;
- the next ordinary defensive foul would award bonus free throws;
- an Elam ending is not active.

Intentional fouling, shooting foul formulas, fouls to give, larger leads, and
earlier game situations retain their existing logic. This changes game outcomes
in the targeted situation; it is a gameplay correction, not a speed optimization.

## NBA evidence

Analyzed 2021-22, 2022-23 and 2023-24 regular-season archives of NBA Stats events
and PBP Stats possessions. The joint sample contains 3,688 games and 728,696
deduplicated possessions. The 2023-24 possession archive contains 1,228 games
rather than all 1,230, and no missing games were imputed.

Source archive: <https://github.com/shufinskiy/nba_data>

The repository HEAD observed at download was
`e829d4678be1e075f99e5d41a1c5f97089be446b`.
`nba-analysis.json` records the URLs, byte sizes and SHA-256 of all six inputs.
The archive mirrors NBA/PBP Stats data; direct spot-check downloads from the NBA
CDN returned HTTP 403, so independent verification against live NBA responses
was unavailable.

### Method

- Remove repeated possession rows: the archive has one row per event, repeating
  the possession metadata. Deduplicate every field except `DESCRIPTION`/`URL`.
- Use the defensive score margin and time **at the start** of the possession.
- Restrict the main comparison to defense tied or ahead by 1-2 points.
- Exclude possessions starting with two seconds or less remaining, to reduce
  dependence on the provider's treatment of near-zero-length possessions.
- Reconstruct team foul counts from raw events, including overtime and the
  final-two-minute allowance. "Bonus" means the **next** common foul awards FTs.
- For the bonus-conditioned estimates, exclude possessions with a defensive
  penalty-counting foul exactly at their starting timestamp, where ordering is
  ambiguous. Do not infer denominator bonus status from whether a foul occurred.
- Match ordinary defensive personal/block fouls by team, period, time interval
  and exact event description. Shooting, offensive, technical, and explicitly
  labeled take fouls are not included in that personal-foul estimate.
- Separately report the possession provider's broader count of non-shooting
  fouls resulting in free throws, which includes additional foul categories.
- "Ordinary" means periods before the fourth, or more than 120 seconds remaining.

The foul-type mapping follows [PBP Stats](https://pbpstats.readthedocs.io/en/latest/_modules/pbpstats/resources/enhanced_pbp/stats_nba/foul.html).
The bonus reconstruction follows [NBA Rule 12](https://official.nba.com/rule-no-12-fouls-and-penalties/).
It agreed with all **43,019** personal-foul penalty markers in the raw archives
(14,964 / 14,078 / 13,977 by season). See `bonus-validation.json`.

### Results when the next foul awards free throws

| Situation, defense tied or up 1-2 | Possessions | With ordinary personal foul | Percentage |
| --- | ---: | ---: | ---: |
| Ordinary game situations | 13,657 | 759 | 5.56% |
| Final 120 seconds, fourth period/OT | 1,902 | 93 | 4.89% |
| Final 60 seconds, fourth period/OT | 1,188 | 46 | 3.87% |
| Final 30 seconds, fourth period/OT | 687 | 24 | 3.49% |

The final-minute sample spans 572 games. A 2,000-resample bootstrap by game gives
approximately 2.87%-4.95% for the final-minute personal-foul percentage, versus
5.17%-5.94% in ordinary situations. These are exploratory intervals, not a causal
estimate of defensive intent. See `uncertainty.json`.

The broader non-shooting-foul-with-FT count is **56 / 1,188 = 4.71 per 100**.
Four explicitly labeled personal take fouls also occur in this sample. Ordinary
personal-foul labels can still conceal intentional fouls; intent is not perfectly
recoverable from play-by-play.

Without bonus free throws pending, the final-minute personal-foul percentage is
10.26% (43 / 419). Thus these data do not justify reducing all late-game fouls.

## Simulation calibration

The NBA per-possession rate cannot replace the game's check probability directly:
rebounds/stoppages can create repeated checks within one possession.

The research harness uses 30 normally generated new-league rosters, and the
1,188 qualifying NBA clock/score/period/start-type states, repeated with 20 seeds
per state. These are synthetic possessions with NBA starting conditions, not
replays using the actual NBA players, fatigue, timeout counts, or shot clocks.
It runs the actual simulation through shots, rebounds and retained possessions.

| Candidate check probability | Simulated non-shooting fouls per 100 possessions |
| --- | ---: |
| 8%, baseline | 8.51 |
| 6%, 25% reduction | 6.53 |
| **4%, 50% reduction** | **4.55** |
| NBA broader non-shooting-with-FT sample | 4.71 |

Each candidate uses 23,760 simulated possessions (71,280 total). The chosen
multiplier is a simple calibration supported by the observed range, not a claim
that NBA teams universally halve fouling. Season-specific results are retained
in `simulation-calibration.json`; all seasons informed selection, so none is
claimed as an untouched holdout. Initial undeveloped-roster diagnostic results
are retained separately and are not the final calibration above.

## Validation

- **332 basketball tests passed; 12 skipped**, including 18 new focused cases.
- TypeScript build, changed-file ESLint, formatting and basketball production
  build passed.
- **1,500 paired full games** with the same initial rosters/seeds, baseline versus
  candidate: all tracked statistics remained finite.
- Total points: 235,215 -> 235,111, or **-0.035 points per team per game**.
- Total fouls: 59,822 -> 59,772; free-throw attempts: 77,168 -> 77,098.
- Summed overtime periods: 49 -> 44. Close-game outcomes can change as intended.
- In 1,349 games with no eligible baseline check, all five measured team totals
  (points, fouls, FTA, FGA, threes) and eligibility counts matched exactly.

Full-game tests use synthetic new-league rosters and disabled injuries. They
check scope and gross balance; they do not establish NBA-wide statistical fidelity,
long-term league balance, or equivalence of every game event.

## Reproduction / artifacts

- `download.py`: retrieve pinned archives and verify their SHA-256 hashes.
- `analyze.py`: standard-library Python analysis of the six `data/*.tar.xz` inputs.
- `audit.py`: reproduce the penalty-marker validation and game-level bootstrap.
- `nba-analysis.json`: coverage, hashes, all season/window/bonus/margin summaries.
- `possessions.jsonl`: deduplicated analyzed possession records.
- `calibration-cases.json`: NBA start states consumed by the simulation harness.
- `foul-calibration.test.ts`: research-only Vitest harness. Copy to the checkout's `work/` folder, put these research artifacts in
  `work/basketball-fouls/`, run `python work/basketball-fouls/download.py`,
  `python work/basketball-fouls/analyze.py`, and then
  `node node_modules/vitest/vitest.mjs run work/foul-calibration.test.ts --project basketball`.
  Move the Node-only harness out before repository-wide typechecking.
- `simulation-calibration.json`, `full-game-summary.json`: final simulation results.
  The harness regenerates the full per-game `full-game-balance.json`.
- Validation logs remain with the local study artifacts; results are summarized above.

Code and tests are on the PR branch; the research files are on this separate evidence branch.
