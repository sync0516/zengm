import { test, assert } from "vitest";
// @ts-expect-error Node-only research harness
import fs from "node:fs";
import GameSim from "../src/worker/core/GameSim.basketball/index.ts";
import { player, team } from "../src/worker/core/index.ts";
import loadTeams from "../src/worker/core/game/loadTeams.ts";
import { g, helpers } from "../src/worker/util/index.ts";
import { resetCache, resetG } from "../src/test/helpers.ts";
import { DEFAULT_LEVEL } from "../src/common/budgetLevels.ts";
import createRandomPlayers from "../src/worker/core/league/create/createRandomPlayers.ts";
import { idb } from "../src/worker/db/index.ts";

test("calibrate late-game foul probability against NBA start states", { timeout: 300000 }, async () => {
 const originalRandom = Math.random;
 let state = 12345;
 const seed = (n: number) => { state = n; };
 Math.random = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
 try {
  resetG();
  g.setWithoutSavingToDB("season", 2024);
  g.setWithoutSavingToDB("startingSeason", 2024);
  const teamsDefault = helpers.getTeamsDefault().slice(0, 30);
  await resetCache({
   teams: teamsDefault.map(team.generate),
   teamSeasons: teamsDefault.map(t=>team.genSeasonRow(t)),
   teamStats: teamsDefault.map(t=>team.genStatsRow(t.tid)),
  });
  const rosterPlayers = await createRandomPlayers({activeTids:teamsDefault.map(t=>t.tid),onlyFreeAgents:false,scoutingLevel:DEFAULT_LEVEL,teams:teamsDefault.map(team.generate)});
  for(const p of rosterPlayers) await idb.cache.players.add(p);
  for(const t of teamsDefault) await team.rosterAutoSort(t.tid);
  const templates = await loadTeams(teamsDefault.map(t=>t.tid), {});
  const root = "work/basketball-fouls/";
  const cases = JSON.parse(fs.readFileSync(root+"calibration-cases.json", "utf8"));
  const results = [];
  for (const multiplier of [1, 0.75, 0.5]) {
   const counts: Record<string,{n:number;fouls:number;shootingFouls:number;checks:number}> = {};
   for (let repetition=0;repetition<20;repetition++) {
    for (let i=0;i<cases.length;i++) {
     const c = cases[i];
     seed(400000 + repetition*cases.length+i);
     const game = new GameSim({gid:0, teams:structuredClone([templates[(i*7)%30]!,templates[(i*7+1+repetition)%30]!]),baseInjuryRate:0,doPlayByPlay:false,homeCourtFactor:1,allStarGame:false,neutralSite:true});
     game.team[0].stat.pts = 100;
     game.team[1].stat.pts = 100+c.lead;
     for (const t of game.team) t.stat.ptsQtrs = [...Array(c.period-1).fill(0),t.stat.pts];
     game.overtimes = c.period-4;
     game.t = c.start;
     game.foulsThisQuarter = [c.period>4?3:4,c.period>4?3:4];
     game.foulsLastTwoMinutes = [1,1];
     game.o=1; game.d=0;
     game.prevPossessionOutcome = c.startType === "Off Timeout" ? "timeout" : c.startType.includes("Make") ? "fg" : "drb";
     game.isClockRunning = !c.startType.includes("Timeout") && !c.startType.includes("Make");
     let nonshooting=0,shooting=0,checks=0;
     const doPf=game.doPf.bind(game);
     game.doPf=info=> { if(info.type==="pfBonus"||info.type==="pfNonShooting")nonshooting++;else shooting++;return doPf(info); };
     const probability=game.probNonShootingFoul.bind(game);
     game.probNonShootingFoul = () => {
      checks++;
      const value=probability();
      return value === 0.04 ? 0.08*multiplier : value;
     };
     let iterations=0;
     do {
      game.simPossession();
      iterations++;
      assert(iterations<100);
     } while(game.t>0&&!game.elamDone&&["orb","nonShootingFoul","timeout","outOfBoundsDefense"].includes(game.prevPossessionOutcome!));
     const row=counts[c.year]??={n:0,fouls:0,shootingFouls:0,checks:0};
     row.n++; row.fouls+=nonshooting; row.shootingFouls+=shooting; row.checks+=checks;
    }
   }
   results.push({multiplier,counts});
   console.log(JSON.stringify(results.at(-1)));
  }
  fs.writeFileSync(root+"simulation-calibration.json",JSON.stringify(results,null,2));
  const fullGames: any[] = [];
  for (const mode of ["baseline", "candidate"]) {
   const totals={mode,games:1500,points:0,pf:0,fta:0,fga:0,tp:0,ot:0,eligibleChecks:0};
   const outcomes=[];
   for(let i=0;i<totals.games;i++) {
    seed(990000+i);
    const game=new GameSim({gid:i,teams:structuredClone([templates[(i*7)%30]!,templates[(i*7+1+Math.floor(i/30)%29)%30]!]),baseInjuryRate:0,doPlayByPlay:false,homeCourtFactor:1,allStarGame:false,neutralSite:true});
    const probability=game.probNonShootingFoul.bind(game);
    let eligible=0;
    game.probNonShootingFoul=()=>{const p=probability();if(p===0.04){eligible++;return mode==="baseline"?0.08:p;}return p;};
    game.run();
    totals.eligibleChecks+=eligible;
    totals.ot+=game.overtimes;
    const summary=game.team.map(t=>({pts:t.stat.pts,pf:t.stat.pf,fta:t.stat.fta,fga:t.stat.fga,tp:t.stat.tp}));
    for(const t of summary){assert(Object.values(t).every(Number.isFinite));totals.points+=t.pts;totals.pf+=t.pf;totals.fta+=t.fta;totals.fga+=t.fga;totals.tp+=t.tp;}
    outcomes.push({eligible,summary});
   }
   fullGames.push({totals,outcomes});
   console.log(JSON.stringify(totals));
  }
  let unchanged=0;
  for(let i=0;i<1500;i++) {
   const before=fullGames[0].outcomes[i];const after=fullGames[1].outcomes[i];
   if(before.eligible===0){assert.deepEqual(after,before);unchanged++;}
  }
  fs.writeFileSync(root+"full-game-balance.json",JSON.stringify({unchangedOutsideScope:unchanged,runs:fullGames},null,2));
 } finally {Math.random=originalRandom;}
});
