const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");

// Runs only in the explicitly supplied checkout. It never resets, stages, or commits Git.
const [repoArg, outputArg, block = "abba"] = process.argv.slice(2);
if (!repoArg || !outputArg || !/^[a-zA-Z0-9_-]+$/.test(block)) {
  throw Error("Usage: node review-stats-audit.cjs CHECKOUT OUTPUT_DIRECTORY [BLOCK_LABEL=abba]");
}
const repo = path.resolve(repoArg);
const output = path.resolve(outputArg);
const variantsDir = path.join(__dirname, "review-stats-variants");
const manifest = JSON.parse(fs.readFileSync(path.join(variantsDir, "manifest.json")));
const changed = manifest.files;
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const git = args => execFileSync("git", args, { cwd: repo }).toString().trim();
const normalized = value => value.toString("utf8").replaceAll("\r\n", "\n");
const configs = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "vitest.config.ts", "tsconfig.json"];
const harnessFiles = ["work/all-sport-bench/vitest.config.ts", "work/all-sport-bench/season.test.browser.ts"];
const walk = directory => {
  const absolute = path.join(repo, directory);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap(entry => {
    const relative = `${directory}/${entry.name}`;
    return entry.isDirectory() ? walk(relative) : entry.isFile() ? [relative] : [];
  });
};
const fingerprint = () => Object.fromEntries(
  [...walk("src"), ...walk("tools"), ...walk("data"), ...configs, ...harnessFiles]
    .filter(file => fs.existsSync(path.join(repo, file)))
    .sort()
    .map(file => [file, sha256(fs.readFileSync(path.join(repo, file)))]),
);
const sourceDifferences = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])]
  .filter(file => a[file] !== b[file]);
const variants = Object.fromEntries(["on", "off"].map(variant => [variant,
  Object.fromEntries(changed.map(file => {
    const source = fs.readFileSync(path.join(variantsDir, variant, file));
    if (sha256(source) !== manifest.sha256[variant][file]) throw Error(`Variant hash mismatch: ${variant}/${file}`);
    return [file, source];
  })),
]));
const original = Object.fromEntries(changed.map(file => {
  const source = fs.readFileSync(path.join(repo, file));
  if (!["on", "off"].some(variant => normalized(source) === normalized(variants[variant][file]))) {
    throw Error(`Refusing to replace an unrecognized source file: ${file}`);
  }
  return [file, source];
}));
for (const file of harnessFiles) {
  if (!fs.existsSync(path.join(repo, file))) throw Error(`Install the updated benchmark harness first: ${file}`);
}
for (const file of [...walk("src"), ...walk("tools")].filter(file => /\.(?:ts|tsx|js|cjs|mjs)$/.test(file))) {
  if (/^(?:<{7}|={7}|>{7})(?: |$)/m.test(fs.readFileSync(path.join(repo, file), "utf8"))) {
    throw Error(`Resolve source conflict markers before benchmarking: ${file}`);
  }
}
const order = ["on", "off", "off", "on"];
const labels = order.map((variant, i) => `review-stats-${block}-${variant}-${i + 1}`);
fs.mkdirSync(output, { recursive: true });
for (const label of labels) {
  for (const suffix of [".json", ".log", "-sources.json"]) {
    if (fs.existsSync(path.join(output, `football-${label}${suffix}`))) {
      throw Error(`Output exists; choose a new output directory or block label: ${label}${suffix}`);
    }
  }
}
const initial = fingerprint();
const runMetadata = {
  head: git(["rev-parse", "HEAD"]),
  upstreamOff: manifest.refs.off,
  onSource: manifest.refs.on,
  node: process.version,
  order,
  seasons: 5,
  warmup: 1,
  seed: 12345,
  checkout: repo,
};
fs.writeFileSync(path.join(output, `${block}-metadata.json`), JSON.stringify(runMetadata, null, 2) + "\n");
const rows = [];
const equivalentKeys = ["sport", "seasons", "warmup", "seed", "initialRandomCalls", "initialRandomState", "games", "measuredGames", "scoreChecksum", "randomCalls", "finalRandomState", "persistedChecksums"];
try {
  for (let i = 0; i < order.length; i++) {
    const variant = order[i];
    const label = labels[i];
    for (const file of changed) fs.writeFileSync(path.join(repo, file), variants[variant][file]);
    const sources = fingerprint();
    const unexpected = sourceDifferences(initial, sources).filter(file => !changed.includes(file));
    if (unexpected.length) throw Error(`Other files changed during audit: ${unexpected.join(", ")}`);
    fs.writeFileSync(path.join(output, `football-${label}-sources.json`), JSON.stringify(sources, null, 2) + "\n");
    const logPath = path.join(output, `football-${label}.log`);
    const log = fs.openSync(logPath, "w");
    console.log(`Starting ${label}: five measured seasons, one warmup, seed 12345`);
    let run;
    try {
      run = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--config", "work/all-sport-bench/vitest.config.ts", "--silent=false", "--reporter=verbose"], {
        cwd: repo,
        env: { ...process.env, SPORT: "football", BENCH_LABEL: label, BENCH_SEASONS: "5", BENCH_WARMUP: "1", BENCH_SEED: "12345", BENCH_PROFILE: "0" },
        stdio: ["ignore", log, log],
      });
    } finally {
      fs.closeSync(log);
    }
    if (run.error || run.status !== 0) throw run.error ?? Error(`Benchmark failed: ${logPath}`);
    const text = fs.readFileSync(logPath, "utf8");
    const records = text.split(/\r?\n/).filter(line => line.startsWith("{") && line.includes('"event":"complete"')).map(line => JSON.parse(line));
    if (records.length !== 1) throw Error(`Expected one complete result: ${logPath}`);
    const result = { ...records[0], variant };
    fs.writeFileSync(path.join(output, `football-${label}.json`), JSON.stringify(result, null, 2) + "\n");
    const duringRun = sourceDifferences(sources, fingerprint());
    if (duringRun.length) throw Error(`Source changed during timed run: ${duringRun.join(", ")}`);
    if (rows.length) {
      const differences = equivalentKeys.filter(key => JSON.stringify(rows[0][key]) !== JSON.stringify(result[key]));
      if (differences.length) throw Error(`Equivalence failed for ${label}: ${differences.join(", ")}`);
    }
    rows.push(result);
    console.log(JSON.stringify({ label, variant, seconds: result.elapsedMs / 1000, exactMatch: true }));
  }
} finally {
  for (const file of changed) {
    const current = fs.readFileSync(path.join(repo, file));
    if (!["on", "off"].some(variant => current.equals(variants[variant][file]))) {
      console.error(`Source was independently edited; preserving it rather than restoring: ${file}`);
      process.exitCode = 1;
    } else {
      fs.writeFileSync(path.join(repo, file), original[file]);
    }
  }
}
const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
const on = rows.filter(row => row.variant === "on").map(row => row.elapsedMs / 1000);
const off = rows.filter(row => row.variant === "off").map(row => row.elapsedMs / 1000);
const pairedImprovementsPercent = [100 * (off[0] - on[0]) / off[0], 100 * (off[1] - on[1]) / off[1]];
const summary = {
  ...runMetadata, onSeconds: on, offSeconds: off,
  onMean: mean(on), offMean: mean(off),
  lessTimeWithPlanningPercent: 100 * (mean(off) - mean(on)) / mean(off),
  pairedImprovementsPercent,
  onRepeatSpreadPercent: 100 * Math.abs(on[1] - on[0]) / mean(on),
  offRepeatSpreadPercent: 100 * Math.abs(off[1] - off[0]) / mean(off),
  exactMatch: true,
  savedTables: Object.keys(rows[0].persistedChecksums).length,
  onlyChangedRuntimeFiles: changed,
};
fs.writeFileSync(path.join(output, `${block}-summary.json`), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
