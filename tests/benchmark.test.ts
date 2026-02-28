import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { compareAgainstCompetitor, compareBenchmarkRun, decideSota } from "../src/benchmark/compare.js";
import { runBenchmark, loadBenchmarkReportByRunId, loadLatestBenchmarkReport } from "../src/benchmark/runner.js";
import { bootstrapWinRateCI, clampScore, computeDimensionScore, median } from "../src/benchmark/scoring.js";
import { verifyRunAttestation } from "../src/benchmark/verify.js";
import type { BenchmarkRunReport } from "../src/core/types.js";

describe("benchmark system", () => {
  let report: BenchmarkRunReport;

  beforeAll(async () => {
    report = await runBenchmark({
      cwd: process.cwd(),
      suite: "core",
      repeats: 1,
      includeHidden: true
    });
  }, 120_000);

  it("produces benchmark report with metadata and probes", () => {
    expect(report.metadata.runId.length).toBeGreaterThan(0);
    expect(report.probeCount).toBeGreaterThanOrEqual(20);
    expect(report.probes.length).toBe(report.probeCount);
    expect(report.overall.score).toBeGreaterThanOrEqual(0);
  });

  it("persists report artifacts on disk", async () => {
    const reportExists = await fs
      .access(report.reportPath)
      .then(() => true)
      .catch(() => false);
    const rawExists = await fs
      .access(report.rawDir)
      .then(() => true)
      .catch(() => false);
    const normalizedExists = await fs
      .access(report.normalizedDir)
      .then(() => true)
      .catch(() => false);

    expect(reportExists).toBe(true);
    expect(rawExists).toBe(true);
    expect(normalizedExists).toBe(true);
  });

  it("loads report by run id and latest pointer", async () => {
    const byId = await loadBenchmarkReportByRunId(process.cwd(), report.metadata.runId);
    const latest = await loadLatestBenchmarkReport(process.cwd());

    expect(byId.metadata.runId).toBe(report.metadata.runId);
    expect(latest?.metadata.runId).toBe(report.metadata.runId);
  });

  it("verifies manifest and signature attestation", async () => {
    const runDir = path.dirname(report.reportPath);
    const verification = await verifyRunAttestation(runDir, {
      keyDir: path.join(process.cwd(), ".salacia", "journal", "bench", "keys")
    });
    expect(verification.manifestVerified).toBe(true);
    expect(verification.signatureVerified).toBe(true);
    expect(verification.ok).toBe(true);
  });

  it("compares run against locked competitor set", async () => {
    const comparisons = await compareBenchmarkRun(report);
    expect(comparisons.length).toBeGreaterThanOrEqual(7);
    expect(comparisons.some((item) => item.comparablePairs > 0)).toBe(true);
    expect(
      comparisons.some((item) => item.dimensions.some((row) => row.outcome === "excluded"))
    ).toBe(true);
  });

  it("computes SOTA decision payload with CI bounds", async () => {
    const comparisons = await compareBenchmarkRun(report);
    const decision = decideSota(report, comparisons);
    expect(typeof decision.passed).toBe("boolean");
    expect(decision.winRate).toBeGreaterThanOrEqual(0);
    expect(decision.winRate).toBeLessThanOrEqual(1);
    expect(decision.ci95.low).toBeLessThanOrEqual(decision.ci95.high);
  });

  it("uses external execution score source when provided", async () => {
    const salaciaDimensions = report.dimensions;
    const comparison = compareAgainstCompetitor(salaciaDimensions, {
      id: "fixture",
      name: "Fixture",
      kind: "open-source",
      license: "Apache-2.0",
      source: "fixture",
      sampledAt: "2026-02-23",
      provenance: "measured",
      evidenceRefs: ["fixtures/evidence.json"],
      dimensions: {
        prompt_quality: 5,
        contract_integrity: 5,
        convergence_robustness: 5,
        execution_governance: 5,
        ide_native_depth: 5,
        protocol_behavior: 5,
        scale_stability: 5,
        compliance_audit: 5,
        anti_gaming: 5
      },
      dimensionProvenance: {
        execution_governance: "measured"
      }
    }, {
      salaciaExternalExecutionScore: 9.25
    });

    const executionRow = comparison.dimensions.find((row) => row.dimension === "execution_governance");
    expect(executionRow?.salacia).toBe(9.25);
    expect(executionRow?.salaciaScoreSource).toBe("external-competitor-run");
  });

  it("uses external measured source for prompt/contract dimensions when provided", () => {
    const comparison = compareAgainstCompetitor(
      report.dimensions,
      {
        id: "fixture-measured",
        name: "Fixture Measured",
        kind: "open-source",
        license: "Apache-2.0",
        source: "fixture",
        sampledAt: "2026-02-23",
        provenance: "measured",
        evidenceRefs: ["fixtures/evidence.json"],
        dimensions: {
          prompt_quality: 7.5,
          contract_integrity: 7.2,
          convergence_robustness: 5,
          execution_governance: 7.8,
          ide_native_depth: 5,
          protocol_behavior: 5,
          scale_stability: 5,
          compliance_audit: 5,
          anti_gaming: 5
        },
        dimensionProvenance: {
          prompt_quality: "measured",
          contract_integrity: "measured",
          execution_governance: "measured"
        }
      },
      {
        salaciaExternalScores: {
          prompt_quality: 9.1,
          contract_integrity: 9.0,
          execution_governance: 8.9
        }
      }
    );

    const promptRow = comparison.dimensions.find((row) => row.dimension === "prompt_quality");
    const contractRow = comparison.dimensions.find((row) => row.dimension === "contract_integrity");
    expect(promptRow?.salaciaScoreSource).toBe("external-competitor-run");
    expect(contractRow?.salaciaScoreSource).toBe("external-competitor-run");
    expect(promptRow?.methodPair).toBe("external-vs-measured");
    expect(contractRow?.methodPair).toBe("external-vs-measured");
  });

  it("prefers successful salacia external execution sample over newer failed sample", async () => {
    const cwd = process.cwd();
    const runsRoot = path.join(cwd, ".salacia", "journal", "bench", "competitor-runs");
    await fs.mkdir(runsRoot, { recursive: true });

    const runSuccess = "test-salacia-success";
    const runFailed = "test-salacia-failed-newer";
    const successDir = path.join(runsRoot, runSuccess);
    const failedDir = path.join(runsRoot, runFailed);
    await fs.mkdir(successDir, { recursive: true });
    await fs.mkdir(failedDir, { recursive: true });

    const successReport = {
      results: [
        {
          competitor: "salacia",
          measured: true,
          success: true,
          testsPassed: true,
          changedFiles: ["src/auth.js"],
          durationMs: 1000,
          stdoutPath: path.join(successDir, "stdout.log"),
          stderrPath: path.join(successDir, "stderr.log")
        }
      ]
    };
    const failedReport = {
      results: [
        {
          competitor: "salacia",
          measured: true,
          success: false,
          testsPassed: false,
          changedFiles: [".salacia/journal/x.json"],
          durationMs: 5000,
          stdoutPath: path.join(failedDir, "stdout.log"),
          stderrPath: path.join(failedDir, "stderr.log")
        }
      ]
    };

    await fs.writeFile(path.join(successDir, "stdout.log"), "", "utf8");
    await fs.writeFile(path.join(successDir, "stderr.log"), "", "utf8");
    await fs.writeFile(path.join(failedDir, "stdout.log"), "", "utf8");
    await fs.writeFile(path.join(failedDir, "stderr.log"), "", "utf8");
    await fs.writeFile(path.join(successDir, "report.json"), JSON.stringify(successReport, null, 2), "utf8");
    await fs.writeFile(path.join(failedDir, "report.json"), JSON.stringify(failedReport, null, 2), "utf8");

    const now = Date.now();
    await fs.utimes(path.join(successDir, "report.json"), new Date(now + 60_000), new Date(now + 60_000));
    await fs.utimes(path.join(failedDir, "report.json"), new Date(now + 120_000), new Date(now + 120_000));

    const competitorSetDir = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-competitor-set-"));
    const competitorSetPath = path.join(competitorSetDir, "COMPETITOR_SET.v1.json");
    await fs.writeFile(
      competitorSetPath,
      JSON.stringify(
        {
          id: "fixture",
          version: "1.0.0",
          generatedAt: "2026-02-23T00:00:00.000Z",
          competitors: [
            {
              id: "fixture",
              name: "Fixture",
              kind: "open-source",
              license: "Apache-2.0",
              source: "fixture",
              sampledAt: "2026-02-23",
              provenance: "measured",
              evidenceRefs: ["fixtures/evidence.json"],
              dimensions: {
                prompt_quality: 5,
                contract_integrity: 5,
                convergence_robustness: 5,
                execution_governance: 5,
                ide_native_depth: 5,
                protocol_behavior: 5,
                scale_stability: 5,
                compliance_audit: 5,
                anti_gaming: 5
              },
              dimensionProvenance: {
                execution_governance: "measured"
              }
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    const comparisons = await compareBenchmarkRun(report, { competitorSetPath });
    const executionRow = comparisons[0]?.dimensions.find((row) => row.dimension === "execution_governance");
    expect(executionRow).toBeDefined();
    expect(executionRow?.salaciaScoreSource).toBe("external-competitor-run");
    expect(executionRow?.salacia).toBeGreaterThan(8);

    await fs.rm(successDir, { recursive: true, force: true });
    await fs.rm(failedDir, { recursive: true, force: true });
    await fs.rm(competitorSetDir, { recursive: true, force: true });
  });

  it("enforces measured-only strict mode with exempt competitor exclusion", () => {
    const syntheticReport: BenchmarkRunReport = {
      metadata: {
        ...report.metadata,
        runId: "synthetic-run"
      },
      config: report.config,
      probeCount: report.probeCount,
      probes: report.probes,
      dimensions: report.dimensions,
      overall: report.overall,
      reportPath: report.reportPath,
      rawDir: report.rawDir,
      normalizedDir: report.normalizedDir
    };

    const decision = decideSota(
      syntheticReport,
      [
        {
          competitorId: "required-profiled",
          competitorName: "Required Profiled",
          provenance: "profiled",
          evidenceRefs: ["fixtures/required.json"],
          strictMode: { status: "required" },
          comparablePairs: 1,
          wins: 1,
          losses: 0,
          ties: 0,
          winRate: 1,
          dimensions: [
            {
              dimension: "prompt_quality",
              salacia: 9,
              competitor: 6,
              outcome: "win",
              salaciaScoreSource: "internal-benchmark",
              competitorDimensionProvenance: "profiled",
              methodPair: "internal-vs-profiled",
              excludedReason: "method-mismatch",
              methodMismatch: true,
              comparable: true
            }
          ]
        },
        {
          competitorId: "exempt-profiled",
          competitorName: "Exempt Profiled",
          provenance: "profiled",
          evidenceRefs: ["fixtures/exempt.json"],
          strictMode: { status: "exempt", reason: "closed-source headless unavailable" },
          comparablePairs: 1,
          wins: 1,
          losses: 0,
          ties: 0,
          winRate: 1,
          dimensions: [
            {
              dimension: "prompt_quality",
              salacia: 9,
              competitor: 6,
              outcome: "win",
              salaciaScoreSource: "internal-benchmark",
              competitorDimensionProvenance: "profiled",
              methodPair: "internal-vs-profiled",
              excludedReason: "method-mismatch",
              methodMismatch: true,
              comparable: true
            }
          ]
        }
      ],
      {
        requireMeasured: true,
        minWinRate: 0,
        qualityFloor: 0
      }
    );

    expect(decision.passed).toBe(false);
    expect(decision.unmeasuredCompetitors).toContain("required-profiled");
    expect(decision.unmeasuredCompetitors).not.toContain("exempt-profiled");
    expect(decision.excludedCompetitors).toContain("exempt-profiled");
  });

  it("tracks excluded and method-mismatch rows in strict sota mode", () => {
    const syntheticReport: BenchmarkRunReport = {
      metadata: {
        ...report.metadata,
        runId: "synthetic-strict-metrics"
      },
      config: report.config,
      probeCount: report.probeCount,
      probes: report.probes,
      dimensions: report.dimensions,
      overall: report.overall,
      reportPath: report.reportPath,
      rawDir: report.rawDir,
      normalizedDir: report.normalizedDir
    };

    const decision = decideSota(
      syntheticReport,
      [
        {
          competitorId: "fixture",
          competitorName: "Fixture",
          provenance: "measured",
          evidenceRefs: ["fixtures/strict.json"],
          strictMode: { status: "required" },
          comparablePairs: 2,
          wins: 1,
          losses: 1,
          ties: 0,
          winRate: 0.5,
          dimensions: [
            {
              dimension: "prompt_quality",
              salacia: 9,
              competitor: 6,
              outcome: "win",
              salaciaScoreSource: "internal-benchmark",
              competitorDimensionProvenance: "profiled",
              methodPair: "internal-vs-profiled",
              excludedReason: "method-mismatch",
              methodMismatch: true,
              comparable: true
            },
            {
              dimension: "execution_governance",
              salacia: 8.2,
              competitor: 8.5,
              outcome: "loss",
              salaciaScoreSource: "external-competitor-run",
              competitorDimensionProvenance: "measured",
              methodPair: "external-vs-measured",
              methodMismatch: false,
              comparable: true
            },
            {
              dimension: "scale_stability",
              salacia: 8.1,
              competitor: null,
              outcome: "excluded",
              salaciaScoreSource: "internal-benchmark",
              competitorDimensionProvenance: "unavailable",
              methodPair: "internal-vs-unavailable",
              excludedReason: "unavailable",
              methodMismatch: true,
              comparable: false
            }
          ]
        }
      ],
      {
        requireMeasured: true,
        minWinRate: 0,
        qualityFloor: 0
      }
    );

    expect(decision.strictMode).toBe(true);
    expect(decision.methodMismatchPairs).toBeGreaterThanOrEqual(1);
    expect(decision.excludedPairs).toBeGreaterThanOrEqual(1);
    expect(decision.externalComparablePairs).toBeGreaterThanOrEqual(1);
    expect(decision.internalOnlyPairs).toBeGreaterThanOrEqual(1);
  });

  it("enforces explicit scale thresholds in configuration", () => {
    expect(report.config.scale.targetFiles).toBeGreaterThanOrEqual(20_000);
    expect(report.config.scale.concurrency).toBeGreaterThanOrEqual(8);
    expect(report.config.scale.soakHours).toBeGreaterThanOrEqual(6);
  });

  it("executes real scale probe and reports actual file coverage metrics", async () => {
    const scaleReport = await runBenchmark({
      cwd: process.cwd(),
      suite: "scale",
      repeats: 1,
      includeHidden: false,
      scale: {
        targetFiles: 1200,
        concurrency: 8,
        soakHours: 1
      }
    });
    const scaleProbe = scaleReport.probes.find((probe) => probe.id === "scale.threshold");
    expect(scaleProbe).toBeDefined();
    expect((scaleProbe?.metrics?.actualFiles as number | undefined) ?? 0).toBeGreaterThanOrEqual(1200);
    expect((scaleProbe?.metrics?.sampleFiles as number | undefined) ?? 0).toBeGreaterThan(0);
    expect((scaleProbe?.metrics?.hashErrors as number | undefined) ?? -1).toBe(0);
  }, 120_000);

  it("compliance probe validates substantive content and audit execution", async () => {
    const complianceProbe = report.probes.find((probe) => probe.id === "compliance.required-artifacts");
    expect(complianceProbe).toBeDefined();
    expect((complianceProbe?.metrics?.substantive as number | undefined) ?? 0).toBeGreaterThanOrEqual(4);
    expect((complianceProbe?.metrics?.auditPassCount as number | undefined) ?? 0).toBeGreaterThanOrEqual(2);
  });
});

describe("benchmark scoring utilities", () => {
  it("computes zero dimension score when functional pass fails", () => {
    expect(computeDimensionScore(0, 10, 10)).toBe(0);
  });

  it("computes weighted dimension score when functional pass succeeds", () => {
    expect(computeDimensionScore(1, 8, 10)).toBe(9);
  });

  it("computes median for odd and even sample sizes", () => {
    expect(median([1, 3, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("computes deterministic bootstrap confidence interval", () => {
    const sample = [1, 1, 0, 1, 0, 1, 1];
    const one = bootstrapWinRateCI(sample, { seed: 42, iterations: 200 });
    const two = bootstrapWinRateCI(sample, { seed: 42, iterations: 200 });

    expect(one.low).toBe(two.low);
    expect(one.high).toBe(two.high);
    expect(one.low).toBeLessThanOrEqual(one.high);
  });

  it("returns bounded scores and empty bootstrap defaults", () => {
    expect(clampScore(11.2)).toBe(10);
    expect(clampScore(-5)).toBe(0);
    expect(bootstrapWinRateCI([])).toEqual({ low: 0, high: 0 });
  });
});
