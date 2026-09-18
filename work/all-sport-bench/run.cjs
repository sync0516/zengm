const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Keep this file at work/all-sport-bench/run.cjs in the checkout being measured.
const repo = path.resolve(__dirname, "../..");
const args = process.argv.slice(2);
const sport = args[0] ?? process.env.SPORT ?? "basketball";
const label = args[1] ?? process.env.BENCH_LABEL ?? "baseline";
const seasons = args[2] ?? process.env.BENCH_SEASONS ?? "3";
const warmup = args[3] ?? process.env.BENCH_WARMUP ?? "1";
const seed = args[4] ?? process.env.BENCH_SEED ?? "12345";
const referencePath = args[5] ?? process.env.BENCH_REFERENCE;
const profile = process.env.BENCH_PROFILE ?? "0";
if (
	!["basketball", "football", "baseball", "hockey"].includes(sport) ||
	!/^[a-zA-Z0-9_-]+$/.test(label) ||
	![seasons, warmup, seed].every(value => /^\d+$/.test(value)) ||
	!Number.isSafeInteger(Number(seasons)) || Number(seasons) < 1 ||
	!Number.isSafeInteger(Number(warmup)) ||
	Number(seed) > 0xffffffff ||
	!["0", "1"].includes(profile) || args.length > 6
) {
	throw Error("Usage: node work/all-sport-bench/run.cjs SPORT LABEL [SEASONS=3] [WARMUP=1] [SEED=12345] [REFERENCE_JSON]");
}

const git = args => {
	const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
	if (result.status !== 0) throw Error(result.stderr || "git failed");
	return result.stdout.trim();
};
const commit = git(["rev-parse", "HEAD"]);
const tree = git(["rev-parse", "HEAD^{tree}"]);
if (git(["status", "--porcelain", "--untracked-files=all", "--", "src"])) {
	throw Error("Commit or restore source changes before measuring a named revision.");
}
if (sport === "football") {
	fs.mkdirSync(path.join(repo, "public/gen"), { recursive: true });
	fs.copyFileSync(
		path.join(repo, "data/real-schedules.football.json"),
		path.join(repo, "public/gen/real-schedules.json"),
	);
}

const outputDir = path.join(__dirname, "results");
fs.mkdirSync(outputDir, { recursive: true });
const prefix = `${sport}-${label}`;
const logPath = path.join(outputDir, `${prefix}.log`);
const log = fs.openSync(logPath, "w");
let run;
console.log(`Starting ${prefix}: ${seasons} measured seasons, ${warmup} warmup`);
try {
	run = spawnSync(process.execPath, [
		"node_modules/vitest/vitest.mjs", "run", "--config",
		"work/all-sport-bench/vitest.config.ts", "--silent=false", "--reporter=verbose",
	], {
		cwd: repo,
		env: { ...process.env, SPORT: sport, BENCH_LABEL: label, BENCH_SEASONS: seasons,
			BENCH_WARMUP: warmup, BENCH_SEED: seed, BENCH_PROFILE: profile },
		stdio: ["ignore", log, log],
	});
} finally {
	fs.closeSync(log);
}
const text = fs.readFileSync(logPath, "utf8");
if (run.error || run.status !== 0) {
	console.error(text.slice(-15000));
	throw run.error ?? Error(`Benchmark failed; see ${logPath}`);
}
const records = text.split(/\r?\n/)
	.filter(line => line.startsWith("{") && line.includes('"event":"complete"'))
	.map(line => JSON.parse(line));
if (records.length !== 1) throw Error(`Expected one complete result in ${logPath}`);
const result = { ...records[0], commit, tree };
if (referencePath) {
	const reference = JSON.parse(fs.readFileSync(path.resolve(referencePath), "utf8"));
	const keys = ["sport", "seasons", "warmup", "seed", "initialRandomCalls", "initialRandomState",
		"games", "measuredGames", "scoreChecksum", "randomCalls", "finalRandomState", "persistedChecksums"];
	const differences = keys.filter(key => JSON.stringify(reference[key]) !== JSON.stringify(result[key]));
	if (differences.length) throw Error(`Equivalence failed: ${differences.join(", ")}`);
}
const resultPath = path.join(outputDir, `${prefix}.json`);
fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ sport, label, seconds: result.elapsedMs / 1000, resultPath,
	...(referencePath ? { exactMatch: true } : {}) }));
