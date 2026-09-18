import { assert, test } from "vitest";
import { cdp, commands } from "vitest/browser";
import { league, GameSim } from "../../src/worker/core/index.ts";
import { g, helpers, local, lock } from "../../src/worker/util/index.ts";
import "../../src/worker/index.ts";
import { idb } from "../../src/worker/db/index.ts";
import createStreamFromLeagueObject from "../../src/worker/core/league/create/createStreamFromLeagueObject.ts";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../src/common/constants.ts";
import { getDefaultSettings } from "../../src/worker/views/newLeague.ts";
import { last } from "../../src/common/utils.ts";
import { defaultGameAttributes } from "../../src/common/defaultGameAttributes.ts";
import { cleanup } from "../../src/test/smoke-helpers.ts";
import { startAutoPlay } from "../../src/worker/core/league/autoPlay.ts";

const options = (globalThis as any).BENCH_OPTIONS;

test("seeded full-season simulation", { timeout: 30 * 60 * 1000 }, async () => {
  const originalRandom = Math.random;
  const run = GameSim.prototype.run;
  let randomState = options.seed;
  let randomCalls = 0;
  let games = 0;
  let scoreChecksum = 0;
  const progress = setInterval(() => console.log(JSON.stringify({event:"progress", sport:options.sport, season:g.get("season"), phase:g.get("phase"), games, status:local.statusText, autoPlay:!!local.autoPlayUntil, gameSim:lock.get("gameSim"), newPhase:lock.get("newPhase")})), 15000);
  Math.random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    randomCalls++;
    return randomState / 4294967296;
  };
  GameSim.prototype.run = function () {
    const result = run.call(this);
    games++;
    for (const t of result.team) scoreChecksum = (Math.imul(scoreChecksum, 31) + t.stat.pts) >>> 0;
    return result;
  } as typeof run;
  try {
    const creationStart = performance.now();
    await league.createStream(createStreamFromLeagueObject({}), {
      confs: last(defaultGameAttributes.confs).value,
      divs: last(defaultGameAttributes.divs).value,
      fromFile: { gameAttributes: undefined, hasRookieContracts: true, maxGid: undefined, startingSeason: undefined, teams: undefined, version: LEAGUE_DATABASE_VERSION },
      getLeagueOptions: undefined, keptKeys: new Set(), lid: 0,
      name: "All-sport simulation benchmark", setLeagueCreationStatus: () => {},
      settings: getDefaultSettings(), shuffleRosters: false,
      startingSeasonFromInput: "2016", teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()), tid: 0,
    });
    // Match the normal beforeView league initialization, including defaults
    // needed by shared simulation code but excluded from this sport's settings.
    await league.loadGameAttributes();
    const creationMs = performance.now() - creationStart;
    const initialRandomState = randomState;
    const initialRandomCalls = randomCalls;
    if (options.warmup > 0) await startAutoPlay(2016 + options.warmup, PHASE.PRESEASON, {});
    assert.equal(g.get("season"), 2016 + options.warmup, "warmup must complete");
    await idb.cache.flush();
    await new Promise(resolve => setTimeout(resolve, 0));
    const warmupGames = games;
    const session = options.profile ? cdp() : undefined;
    if (session) { await session.send("Profiler.enable"); await session.send("Profiler.start"); }
    console.log(JSON.stringify({ event: "started", ...options, creationMs, initialRandomCalls, initialRandomState }));
    const start = performance.now();
    await startAutoPlay(2016 + options.warmup + options.seasons, PHASE.PRESEASON, {});
    await idb.cache.flush();
    const elapsedMs = performance.now() - start;
    if (session) {
      const { profile } = await session.send("Profiler.stop");
      await commands.writeFile(`work/all-sport-bench/profile-${options.sport}-${options.label}.json`, JSON.stringify(profile));
    }
    assert.equal(g.get("season"), 2016 + options.warmup + options.seasons);
    assert.equal(g.get("phase"), PHASE.PRESEASON);
    assert.isAbove(games - warmupGames, 0);
    await idb.cache.flush();
    const persistedChecksums: Record<string, string> = {};
    for (const store of ["players", "teams", "teamSeasons", "teamStats", "awards", "playoffSeries", "games", "allStars", "draftLotteryResults", "draftPicks", "events", "headToHeads", "messages", "negotiations", "playerFeats", "releasedPlayers", "schedule", "seasonLeaders", "trade", "scheduledEvents", "savedTrades", "savedTradingBlock"] as const) {
      const rows = await idb.league.getAll(store);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(rows)));
      persistedChecksums[store] = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    }
    console.log(JSON.stringify({ event: "complete", ...options, elapsedMs, creationMs, initialRandomCalls, initialRandomState, games, measuredGames: games - warmupGames, scoreChecksum, randomCalls, finalRandomState: randomState, persistedChecksums }));
    await cleanup();
  } finally {
    clearInterval(progress);
    Math.random = originalRandom;
    GameSim.prototype.run = run;
  }
});
