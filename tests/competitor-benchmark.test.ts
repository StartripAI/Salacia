import { describe, expect, it } from "vitest";
import { runCompetitorBenchmark } from "../src/benchmark/competitor.js";

describe("competitor benchmark harness", () => {
  it("runs deterministic salacia fallback and records unavailable competitor", async () => {
    const prevBackend = process.env.BENCH_SALACIA_BACKEND;
    process.env.BENCH_SALACIA_BACKEND = "control";
    try {
      const report = await runCompetitorBenchmark({
        cwd: process.cwd(),
        competitors: ["salacia", "cursor"],
        timeoutMs: 60_000
      });

      expect(report.runId.length).toBeGreaterThan(0);
      expect(report.results.length).toBe(2);

      const control = report.results.find((item) => item.competitor === "salacia");
      const cursor = report.results.find((item) => item.competitor === "cursor");

      expect(control?.measured).toBe(false);
      expect(control?.testsPassed).toBe(true);
      expect((control?.changedFiles.length ?? 0) > 0).toBe(true);
      expect(control?.reason?.toLowerCase().includes("control fallback")).toBe(true);

      expect(cursor?.available).toBe(false);
      expect(cursor?.measured).toBe(false);
    } finally {
      if (typeof prevBackend === "string") {
        process.env.BENCH_SALACIA_BACKEND = prevBackend;
      } else {
        delete process.env.BENCH_SALACIA_BACKEND;
      }
    }
  }, 120_000);

  it("supports headless command override for bridge-only competitors", async () => {
    const prevJsonOverride = process.env.BENCH_CLINE_CMD_JSON;
    process.env.BENCH_CLINE_CMD_JSON = JSON.stringify({
      command: "node",
      args: [
        "-e",
        "const fs=require('node:fs'); const p=process.argv[1]; let s=fs.readFileSync(p,'utf8'); s=s.replace('return Boolean(username) && password.length >= 8;','return username.trim().length > 0 && password.length >= 8;'); fs.writeFileSync(p,s);",
        "{authFile}"
      ]
    });

    try {
      const report = await runCompetitorBenchmark({
        cwd: process.cwd(),
        competitors: ["cline"],
        timeoutMs: 60_000
      });

      expect(report.results.length).toBe(1);
      const cline = report.results[0];
      if (!cline) {
        throw new Error("Missing cline benchmark result");
      }
      expect(cline.competitor).toBe("cline");
      expect(cline.available).toBe(true);
      expect(cline.measured).toBe(true);
      expect(cline.success).toBe(true);
      expect(cline.testsPassed).toBe(true);
      expect((cline.changedFiles.length ?? 0) > 0).toBe(true);
    } finally {
      if (typeof prevJsonOverride === "string") {
        process.env.BENCH_CLINE_CMD_JSON = prevJsonOverride;
      } else {
        delete process.env.BENCH_CLINE_CMD_JSON;
      }
    }
  }, 120_000);

  it("blocks legacy shell template override unless explicitly enabled", async () => {
    const prevLegacy = process.env.BENCH_CLINE_CMD;
    const prevAllowLegacy = process.env.BENCH_ALLOW_LEGACY_SHELL_TEMPLATE;
    delete process.env.BENCH_ALLOW_LEGACY_SHELL_TEMPLATE;
    process.env.BENCH_CLINE_CMD = "echo injected; false";

    try {
      const report = await runCompetitorBenchmark({
        cwd: process.cwd(),
        competitors: ["cline"],
        timeoutMs: 60_000
      });

      const cline = report.results[0];
      if (!cline) {
        throw new Error("Missing cline benchmark result");
      }
      expect(cline.available).toBe(true);
      expect(cline.measured).toBe(false);
      expect(cline.success).toBe(false);
      expect(cline.reason?.includes("disabled by default")).toBe(true);
    } finally {
      if (typeof prevLegacy === "string") {
        process.env.BENCH_CLINE_CMD = prevLegacy;
      } else {
        delete process.env.BENCH_CLINE_CMD;
      }
      if (typeof prevAllowLegacy === "string") {
        process.env.BENCH_ALLOW_LEGACY_SHELL_TEMPLATE = prevAllowLegacy;
      } else {
        delete process.env.BENCH_ALLOW_LEGACY_SHELL_TEMPLATE;
      }
    }
  }, 120_000);
});
