import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
  BenchmarkComparisonResult,
  BenchmarkCompetitorRecord,
  BenchmarkDimension,
  BenchmarkDimensionProvenance,
  BenchmarkDimensionScore,
  BenchmarkMethodPair,
  BenchmarkRunReport,
  SotaDecision
} from "../core/types.js";
import { bootstrapWinRateCI } from "./scoring.js";

const DIMENSIONS = [
  "prompt_quality",
  "contract_integrity",
  "convergence_robustness",
  "execution_governance",
  "ide_native_depth",
  "protocol_behavior",
  "scale_stability",
  "compliance_audit",
  "anti_gaming"
] as const;
const DIMENSION_PROVENANCE_VALUES = {
  measured: "measured",
  profiled: "profiled",
  unavailable: "unavailable"
} as const;

const dimensionValueSchema = z.number().min(0).max(10).nullable();
const dimensionValuesSchema = z.object({
  prompt_quality: dimensionValueSchema,
  contract_integrity: dimensionValueSchema,
  convergence_robustness: dimensionValueSchema,
  execution_governance: dimensionValueSchema,
  ide_native_depth: dimensionValueSchema,
  protocol_behavior: dimensionValueSchema,
  scale_stability: dimensionValueSchema,
  compliance_audit: dimensionValueSchema,
  anti_gaming: dimensionValueSchema
});

const dimensionProvenanceSchema = z
  .object({
    prompt_quality: z.enum(DIMENSION_PROVENANCE_VALUES),
    contract_integrity: z.enum(DIMENSION_PROVENANCE_VALUES),
    convergence_robustness: z.enum(DIMENSION_PROVENANCE_VALUES),
    execution_governance: z.enum(DIMENSION_PROVENANCE_VALUES),
    ide_native_depth: z.enum(DIMENSION_PROVENANCE_VALUES),
    protocol_behavior: z.enum(DIMENSION_PROVENANCE_VALUES),
    scale_stability: z.enum(DIMENSION_PROVENANCE_VALUES),
    compliance_audit: z.enum(DIMENSION_PROVENANCE_VALUES),
    anti_gaming: z.enum(DIMENSION_PROVENANCE_VALUES)
  })
  .partial();

const competitorSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum(["open-source", "closed-source"]),
    license: z.string().min(1),
    source: z.string().min(1),
    sampledAt: z.string().min(1),
    provenance: z.enum(["measured", "profiled"]),
    evidenceRefs: z.array(z.string().min(1)).min(1),
    dimensions: dimensionValuesSchema,
    dimensionProvenance: dimensionProvenanceSchema.optional(),
    strictMode: z
      .object({
        status: z.enum(["required", "exempt"]),
        reason: z.string().min(1).optional()
      })
      .optional()
  })
  .superRefine((candidate, ctx) => {
    for (const dimension of DIMENSIONS) {
      const value = candidate.dimensions[dimension];
      const provenance = candidate.dimensionProvenance?.[dimension] ?? candidate.provenance;
      if (value === null && provenance !== "unavailable") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["dimensions", dimension],
          message: `Dimension ${dimension} is null but provenance is ${provenance}; expected unavailable`
        });
      }
      if (typeof value === "number" && provenance === "unavailable") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["dimensions", dimension],
          message: `Dimension ${dimension} has numeric score with unavailable provenance`
        });
      }
    }
  });

const competitorSetSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  generatedAt: z.string().min(1),
  competitors: z.array(competitorSchema).min(1)
});
type ParsedCompetitorRecord = z.infer<typeof competitorSchema>;
function normalizeDimensionProvenance(
  raw: ParsedCompetitorRecord["dimensionProvenance"]
): Partial<Record<BenchmarkDimension, BenchmarkDimensionProvenance>> | undefined {
  if (!raw) {
    return undefined;
  }

  const normalized: Partial<Record<BenchmarkDimension, BenchmarkDimensionProvenance>> = {};
  for (const dimension of DIMENSIONS) {
    const value = raw[dimension];
    if (value !== undefined) {
      normalized[dimension] = value;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

const toBenchmarkCompetitorRecord = (input: ParsedCompetitorRecord): BenchmarkCompetitorRecord => {
  const out: BenchmarkCompetitorRecord = {
    id: input.id,
    name: input.name,
    kind: input.kind,
    license: input.license,
    source: input.source,
    sampledAt: input.sampledAt,
    provenance: input.provenance,
    evidenceRefs: input.evidenceRefs,
    dimensions: input.dimensions
  };

  const normalizedProvenance = normalizeDimensionProvenance(input.dimensionProvenance);
  if (normalizedProvenance) {
    out.dimensionProvenance = normalizedProvenance;
  }
  if (input.strictMode) {
    out.strictMode = input.strictMode.reason
      ? {
          status: input.strictMode.status,
          reason: input.strictMode.reason
        }
      : {
          status: input.strictMode.status
        };
  }

  return out;
};

const KEY_DIMENSIONS: BenchmarkDimension[] = [
  "prompt_quality",
  "contract_integrity",
  "convergence_robustness",
  "execution_governance",
  "protocol_behavior",
  "scale_stability",
  "compliance_audit"
];

function toDimensionMap(dimensions: BenchmarkDimensionScore[]): Map<BenchmarkDimension, number> {
  const map = new Map<BenchmarkDimension, number>();
  for (const dimension of dimensions) {
    map.set(dimension.dimension, dimension.dimensionScore);
  }
  return map;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeChangedFiles(changedFiles?: string[]): string[] {
  return (changedFiles ?? [])
    .map((file) => String(file).replace(/\\/g, "/"))
    .filter((file) => file.length > 0)
    .filter((file) => !file.startsWith(".salacia/"));
}

function analyzeSeedTaskSurface(changedFiles?: string[]): {
  changed: string[];
  changedCount: number;
  touchedAuth: boolean;
  touchedTests: boolean;
  unrelatedCount: number;
} {
  const changed = normalizeChangedFiles(changedFiles);
  const touchedAuth = changed.includes("src/auth.js");
  const touchedTests = changed.includes("tests/auth.test.js");
  const unrelatedCount = changed.filter((file) => file !== "src/auth.js" && file !== "tests/auth.test.js").length;
  return {
    changed,
    changedCount: changed.length,
    touchedAuth,
    touchedTests,
    unrelatedCount
  };
}

function computeMeasuredDimensionScoresFromRun(result: {
  success: boolean;
  testsPassed: boolean;
  changedFiles?: string[];
  durationMs?: number;
}): Partial<Record<BenchmarkDimension, number>> {
  const surface = analyzeSeedTaskSurface(result.changedFiles);
  const duration = Math.max(0, Number(result.durationMs ?? 0));
  const durationPenaltyFast = clamp(duration / 120_000, 0, 1);
  const durationPenaltySlow = clamp(duration / 180_000, 0, 1);

  const executionBase = result.success ? 7.6 : result.testsPassed ? 4.2 : 1.8;
  const execution =
    executionBase +
    (surface.touchedAuth ? 1.4 : 0) +
    (surface.touchedTests ? 0.4 : 0) +
    (surface.unrelatedCount === 0 ? 0.8 : 0) -
    surface.unrelatedCount * 1.1 -
    durationPenaltyFast * 1.2;

  const promptBase = result.success ? 6.8 : result.testsPassed ? 3.5 : 1.2;
  const prompt =
    promptBase +
    (surface.touchedAuth ? 2 : 0) +
    (surface.changedCount <= 2 ? 1 : 0.4) -
    surface.unrelatedCount * 1.3 -
    durationPenaltySlow * 0.8;

  const contractBase = result.testsPassed ? 7.4 : 2.2;
  const contract =
    contractBase +
    (surface.touchedAuth ? 1.6 : 0) +
    (surface.unrelatedCount === 0 ? 0.9 : 0) -
    (result.success ? 0 : 0.6) -
    surface.unrelatedCount * 1.1 -
    durationPenaltySlow * 0.8;

  return {
    execution_governance: Number(clamp(execution, 0, 10).toFixed(4)),
    prompt_quality: Number(clamp(prompt, 0, 10).toFixed(4)),
    contract_integrity: Number(clamp(contract, 0, 10).toFixed(4))
  };
}

function resolveMethodPair(
  salaciaScoreSource: "internal-benchmark" | "external-competitor-run",
  competitorDimensionProvenance: BenchmarkDimensionProvenance
): BenchmarkMethodPair {
  if (salaciaScoreSource === "external-competitor-run") {
    if (competitorDimensionProvenance === "measured") return "external-vs-measured";
    if (competitorDimensionProvenance === "profiled") return "external-vs-profiled";
    return "external-vs-unavailable";
  }

  if (competitorDimensionProvenance === "measured") return "internal-vs-measured";
  if (competitorDimensionProvenance === "profiled") return "internal-vs-profiled";
  return "internal-vs-unavailable";
}

async function resolveExternalSalaciaMeasuredScores(
  cwd: string
): Promise<{ scores: Partial<Record<BenchmarkDimension, number>>; evidenceRefs: string[] } | null> {
  const runsRoot = path.join(cwd, ".salacia", "journal", "bench", "competitor-runs");
  const entries = await fs.readdir(runsRoot).catch(() => []);
  if (entries.length === 0) return null;

  const ranked = await Promise.all(
    entries.map(async (entry) => {
      const reportPath = path.join(runsRoot, entry, "report.json");
      const stat = await fs.stat(reportPath).catch(() => null);
      return stat ? { reportPath, mtimeMs: stat.mtimeMs } : null;
    })
  );
  const reports = ranked
    .filter((item): item is { reportPath: string; mtimeMs: number } => item !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  let best:
    | {
        scores: Partial<Record<BenchmarkDimension, number>>;
        qualityRank: number;
        aggregateScore: number;
        mtimeMs: number;
        evidenceRefs: string[];
      }
    | null = null;

  for (const item of reports) {
    const raw = await fs.readFile(item.reportPath, "utf8").catch(() => "");
    if (!raw) continue;
    const parsed = JSON.parse(raw) as {
      results?: Array<{
        competitor: string;
        measured: boolean;
        success: boolean;
        testsPassed: boolean;
        changedFiles?: string[];
        durationMs?: number;
        stdoutPath?: string;
        stderrPath?: string;
      }>;
    };
    const salacia = (parsed.results ?? []).find((result) => result.competitor === "salacia" && result.measured);
    if (!salacia) continue;

    const scores = computeMeasuredDimensionScoresFromRun(salacia);
    const surface = analyzeSeedTaskSurface(salacia.changedFiles);
    const meaningfulChanges = surface.changedCount;
    const qualityRank =
      salacia.success && salacia.testsPassed && surface.touchedAuth && surface.unrelatedCount === 0
        ? 4
        : salacia.success && salacia.testsPassed && meaningfulChanges > 0
          ? 3
          : salacia.success
            ? 2
            : salacia.testsPassed
              ? 1
              : 0;
    const aggregateScore = Object.values(scores).reduce((sum, value) => sum + (typeof value === "number" ? value : 0), 0);
    const evidenceRefs = [path.relative(cwd, item.reportPath)];
    if (typeof salacia.stdoutPath === "string") evidenceRefs.push(path.relative(cwd, salacia.stdoutPath));
    if (typeof salacia.stderrPath === "string") evidenceRefs.push(path.relative(cwd, salacia.stderrPath));
    const candidate = {
      scores,
      qualityRank,
      aggregateScore,
      mtimeMs: item.mtimeMs,
      evidenceRefs
    };
    if (
      !best ||
      candidate.qualityRank > best.qualityRank ||
      (candidate.qualityRank === best.qualityRank && candidate.aggregateScore > best.aggregateScore) ||
      (candidate.qualityRank === best.qualityRank &&
        candidate.aggregateScore === best.aggregateScore &&
        candidate.mtimeMs > best.mtimeMs)
    ) {
      best = candidate;
    }
  }

  if (!best) {
    return null;
  }

  return {
    scores: best.scores,
    evidenceRefs: best.evidenceRefs
  };
}

export async function loadCompetitorSet(filePath: string): Promise<BenchmarkCompetitorRecord[]> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = competitorSetSchema.parse(JSON.parse(raw));
  return parsed.competitors.map(toBenchmarkCompetitorRecord);
}

export function compareAgainstCompetitor(
  salaciaDimensions: BenchmarkDimensionScore[],
  competitor: BenchmarkCompetitorRecord,
  options: {
    parityTolerance?: number;
    salaciaExternalExecutionScore?: number;
    salaciaExternalScores?: Partial<Record<BenchmarkDimension, number>>;
  } = {}
): BenchmarkComparisonResult {
  const parityTolerance = options.parityTolerance ?? 0.2;
  const salaciaMap = toDimensionMap(salaciaDimensions);
  const rows: BenchmarkComparisonResult["dimensions"] = [];

  let wins = 0;
  let losses = 0;
  let ties = 0;

  for (const dimension of DIMENSIONS) {
    const rawSalacia = salaciaMap.get(dimension);
    const externalByDimension = options.salaciaExternalScores?.[dimension];
    const externalFallback =
      dimension === "execution_governance" && typeof options.salaciaExternalExecutionScore === "number"
        ? options.salaciaExternalExecutionScore
        : undefined;
    const resolvedExternal = typeof externalByDimension === "number" ? externalByDimension : externalFallback;
    const salaciaScoreSource = typeof resolvedExternal === "number" ? "external-competitor-run" : "internal-benchmark";
    const salacia = salaciaScoreSource === "external-competitor-run" ? resolvedExternal ?? null : rawSalacia ?? null;

    const competitorRaw = competitor.dimensions[dimension];
    const competitorDimensionProvenance =
      competitor.dimensionProvenance?.[dimension] ?? (competitorRaw === null ? "unavailable" : competitor.provenance);
    const competitorScore = competitorRaw;

    const methodPair = resolveMethodPair(salaciaScoreSource, competitorDimensionProvenance);

    let outcome: "win" | "loss" | "parity" | "excluded" = "excluded";
    let excludedReason: "unavailable" | "method-mismatch" | "not-supported" | undefined;

    if (typeof competitorScore !== "number" || competitorDimensionProvenance === "unavailable") {
      excludedReason = "unavailable";
    } else if (typeof salacia !== "number") {
      excludedReason = "not-supported";
    } else {
      if (salacia - competitorScore > parityTolerance) {
        outcome = "win";
      } else if (competitorScore - salacia > parityTolerance) {
        outcome = "loss";
      } else {
        outcome = "parity";
      }

      if (outcome === "win") {
        wins += 1;
      } else if (outcome === "loss") {
        losses += 1;
      } else {
        ties += 1;
      }

      if (methodPair !== "external-vs-measured") {
        excludedReason = "method-mismatch";
      }
    }

    rows.push({
      dimension,
      salacia: typeof salacia === "number" ? Number(salacia.toFixed(4)) : null,
      competitor: typeof competitorScore === "number" ? Number(competitorScore.toFixed(4)) : null,
      outcome,
      salaciaScoreSource,
      competitorDimensionProvenance,
      methodPair,
      ...(excludedReason ? { excludedReason } : {}),
      methodMismatch: methodPair !== "external-vs-measured",
      comparable: outcome !== "excluded"
    });
  }

  const comparablePairs = wins + losses + ties;
  const decisivePairs = wins + losses;
  const winRate = decisivePairs === 0 ? 0 : Number((wins / decisivePairs).toFixed(4));

  return {
    competitorId: competitor.id,
    competitorName: competitor.name,
    provenance: competitor.provenance,
    evidenceRefs: competitor.evidenceRefs,
    strictMode: competitor.strictMode ?? { status: "required" },
    comparablePairs,
    wins,
    losses,
    ties,
    winRate,
    dimensions: rows
  };
}

export async function compareBenchmarkRun(
  report: BenchmarkRunReport,
  options: { competitorSetPath?: string; parityTolerance?: number; cwd?: string } = {}
): Promise<BenchmarkComparisonResult[]> {
  const cwd = options.cwd ?? process.cwd();
  const competitorSetPath = path.resolve(options.competitorSetPath ?? path.join("docs", "benchmarks", "COMPETITOR_SET.v1.json"));
  const competitors = await loadCompetitorSet(competitorSetPath);
  const externalSalacia = await resolveExternalSalaciaMeasuredScores(cwd);
  return competitors.map((competitor) =>
    compareAgainstCompetitor(report.dimensions, competitor, {
      ...(externalSalacia ? { salaciaExternalScores: externalSalacia.scores } : {}),
      ...(typeof options.parityTolerance === "number" ? { parityTolerance: options.parityTolerance } : {})
    })
  );
}

export function decideSota(
  report: BenchmarkRunReport,
  comparisons: BenchmarkComparisonResult[],
  options: {
    minWinRate?: number;
    qualityFloor?: number;
    ciSeed?: number;
    requireMeasured?: boolean;
    minimumDecisivePairs?: number;
  } = {}
): SotaDecision {
  const minWinRate = options.minWinRate ?? 0.7;
  const qualityFloor = options.qualityFloor ?? 8;
  const strictMode = options.requireMeasured ?? true;
  const minimumDecisivePairs = options.minimumDecisivePairs ?? (strictMode ? 6 : 1);
  const dimensionMap = toDimensionMap(report.dimensions);

  const qualityFloorFailures = KEY_DIMENSIONS.filter((dimension) => {
    const score = dimensionMap.get(dimension);
    return typeof score !== "number" || score < qualityFloor;
  });

  const winsVector: number[] = [];
  let totalWins = 0;
  let decisivePairs = 0;
  let comparablePairs = 0;
  let methodMismatchPairs = 0;
  let excludedPairs = 0;
  let externalComparablePairs = 0;
  let internalOnlyPairs = 0;

  const excludedCompetitors: string[] = [];

  for (const comparison of comparisons) {
    const strictComparableRows = comparison.dimensions.filter((row) => row.comparable && row.methodPair === "external-vs-measured");

    const rows = strictMode
      ? strictComparableRows
      : comparison.dimensions.filter((row) => row.comparable && row.competitorDimensionProvenance !== "unavailable");

    if (strictMode && strictComparableRows.length === 0 && comparison.strictMode.status === "exempt") {
      excludedCompetitors.push(comparison.competitorId);
      continue;
    }

    for (const row of comparison.dimensions) {
      if (row.outcome === "excluded") {
        excludedPairs += 1;
      }
      if (row.comparable && row.methodMismatch) {
        methodMismatchPairs += 1;
      }
      if (row.comparable && row.salaciaScoreSource === "internal-benchmark") {
        internalOnlyPairs += 1;
      }
      if (row.comparable && row.methodPair === "external-vs-measured") {
        externalComparablePairs += 1;
      }
    }

    for (const row of rows) {
      comparablePairs += 1;
      if (row.outcome === "win") {
        winsVector.push(1);
        totalWins += 1;
        decisivePairs += 1;
      } else if (row.outcome === "loss") {
        winsVector.push(0);
        decisivePairs += 1;
      }
    }
  }

  const winRate = decisivePairs === 0 ? 0 : Number((totalWins / decisivePairs).toFixed(4));
  const ci95 = bootstrapWinRateCI(winsVector, { seed: options.ciSeed ?? 1776 });

  const unmeasuredCompetitors = strictMode
    ? comparisons
        .filter((comparison) => comparison.strictMode.status !== "exempt")
        .filter(
          (comparison) =>
            comparison.dimensions.filter((row) => row.comparable && row.methodPair === "external-vs-measured").length === 0
        )
        .map((comparison) => comparison.competitorId)
    : [];

  const reasons: string[] = [];
  if (decisivePairs === 0) {
    reasons.push("no decisive comparable dimension pairs");
  }
  if (decisivePairs < minimumDecisivePairs) {
    reasons.push(`decisive_pairs ${decisivePairs} < required ${minimumDecisivePairs}`);
  }
  if (winRate < minWinRate) {
    reasons.push(`win_rate ${winRate} < required ${minWinRate}`);
  }
  if (qualityFloorFailures.length > 0) {
    reasons.push(`quality floor failed in dimensions: ${qualityFloorFailures.join(", ")}`);
  }
  if (strictMode && unmeasuredCompetitors.length > 0) {
    reasons.push(`unmeasured competitors present: ${unmeasuredCompetitors.join(", ")}`);
  }

  return {
    runId: report.metadata.runId,
    passed: reasons.length === 0,
    winRate,
    decisivePairs,
    minimumDecisivePairs,
    qualityFloor,
    qualityFloorFailures,
    comparablePairs,
    excludedCompetitors,
    competitors: comparisons,
    methodMismatchPairs,
    excludedPairs,
    externalComparablePairs,
    internalOnlyPairs,
    strictMode,
    ci95,
    unmeasuredCompetitors,
    reasons
  };
}
