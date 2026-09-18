import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import { sportFunctions } from "../../tools/lib/rolldownPlugins/sportFunctions.ts";
import type { Sport } from "../../tools/lib/getSport.ts";

const sport = (process.env.SPORT ?? "basketball") as Sport;
export default defineConfig({
  define: {
    __NODE_ENV: JSON.stringify("test"),
    __SPORT: JSON.stringify(sport),
    "globalThis.BENCH_OPTIONS": JSON.stringify({
      sport,
      label: process.env.BENCH_LABEL ?? "baseline",
      seasons: Number(process.env.BENCH_SEASONS ?? 3),
      warmup: Number(process.env.BENCH_WARMUP ?? 1),
      seed: Number(process.env.BENCH_SEED ?? 12345),
      profile: process.env.BENCH_PROFILE === "1",
    }),
  },
  plugins: [{ ...sportFunctions("production", sport), enforce: "pre" }],
  test: {
    include: ["work/all-sport-bench/season.test.browser.ts"],
    setupFiles: ["./src/test/setup-e2e.ts"],
    isolate: false,
    maxWorkers: 1,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});
