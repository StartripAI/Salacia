#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const COMPETITOR_SET_PATH = path.join("docs", "benchmarks", "COMPETITOR_SET.v1.json");
const RUNS_ROOT = path.join(".salacia", "journal", "bench", "competitor-runs");
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
];
const TASK_MEASURED_DIMENSIONS = ["execution_governance", "prompt_quality", "contract_integrity"];

const COMPETITOR_ID_MAP = new Map([
  ["aider", "aider"],
  ["claude", "claude-code"],
  ["codex", "codex"],
  ["cline", "cline"],
  ["continue", "continue"],
  ["opencode", "opencode"],
  ["cursor", "cursor"],
  ["trellis", "trellis"]
]);

function parseArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function toDateOnly(value) {
  const date = new Date(value);
  const y = date.getUTCFullYear();
  const m = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const d = `${date.getUTCDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeChangedFiles(changedFiles) {
  return (changedFiles ?? [])
    .map((file) => String(file).replace(/\\/g, "/"))
    .filter((file) => file.length > 0)
    .filter((file) => !file.startsWith(".salacia/"));
}

function analyzeSeedTaskSurface(changedFiles) {
  const changed = normalizeChangedFiles(changedFiles);
  const touchedAuth = changed.includes("src/auth.js");
  const touchedTests = changed.includes("tests/auth.test.js");
  const unrelatedCount = changed.filter((file) => file !== "src/auth.js" && file !== "tests/auth.test.js").length;
  return {
    changedCount: changed.length,
    touchedAuth,
    touchedTests,
    unrelatedCount
  };
}

function withDimensionDefaults(record) {
  const next = record;
  if (!next.dimensions || typeof next.dimensions !== "object") {
    next.dimensions = {};
  }
  if (!next.dimensionProvenance || typeof next.dimensionProvenance !== "object") {
    next.dimensionProvenance = {};
  }
  for (const dimension of DIMENSIONS) {
    if (!(dimension in next.dimensions)) {
      next.dimensions[dimension] = null;
    }
    if (!next.dimensionProvenance[dimension]) {
      next.dimensionProvenance[dimension] = next.dimensions[dimension] === null ? "unavailable" : "profiled";
    }
    if (next.dimensionProvenance[dimension] === "unavailable") {
      next.dimensions[dimension] = null;
    }
    if (next.dimensions[dimension] === null && next.dimensionProvenance[dimension] !== "unavailable") {
      next.dimensionProvenance[dimension] = "unavailable";
    }
    if (next.dimensions[dimension] !== null && next.dimensionProvenance[dimension] === "unavailable") {
      next.dimensions[dimension] = null;
    }
  }

  if (next.id === "trellis") {
    for (const dimension of DIMENSIONS) {
      if (dimension === "execution_governance") continue;
      next.dimensions[dimension] = null;
      next.dimensionProvenance[dimension] = "unavailable";
    }
  } else {
    for (const dimension of DIMENSIONS) {
      if (next.dimensionProvenance[dimension] === "unavailable") {
        next.dimensions[dimension] = null;
      }
    }
  }

  if (!next.strictMode || typeof next.strictMode !== "object") {
    next.strictMode =
      next.id === "cursor"
        ? {
            status: "exempt",
            reason: "closed-source IDE has no official headless automation entrypoint"
          }
        : {
            status: "required"
          };
  }
  return next;
}

function computeMeasuredDimensionScores(result) {
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
    execution_governance: Number(clamp(execution, 0, 10).toFixed(2)),
    prompt_quality: Number(clamp(prompt, 0, 10).toFixed(2)),
    contract_integrity: Number(clamp(contract, 0, 10).toFixed(2))
  };
}

function isEnvironmentFailure(result) {
  if (!result.available) {
    return true;
  }

  const reason = String(result.reason ?? "").toLowerCase();
  if (!reason) {
    return false;
  }

  return /(not authenticated|authentication|api key|unauthorized|forbidden|binary not found|harness not implemented|adapter unavailable|command timed out|timeout|network|connection refused|dns|rate limit|quota|no llm model|missing model|provider key|missing credentials|\b401\b|\b403\b|user not found)/i.test(
    reason
  );
}

function resolvePath(cwd, maybePath) {
  if (!maybePath || typeof maybePath !== "string") {
    return null;
  }
  return path.isAbsolute(maybePath) ? maybePath : path.join(cwd, maybePath);
}

async function readLogSample(cwd, logPath) {
  const resolved = resolvePath(cwd, logPath);
  if (!resolved) return "";
  const raw = await fs.readFile(resolved, "utf8").catch(() => "");
  if (!raw) return "";
  return raw.slice(0, 16_000);
}

function looksLikeHarnessUsageFailure(text) {
  if (!text) return false;
  return /(show help|usage:|unknown option|invalid option|choices:\s*\[|run opencode with a message|headless benchmark harness not implemented|command failed:\s*sh\s+-lc)/i.test(
    text
  );
}

async function isHarnessUsageFailure(result, cwd) {
  const reason = String(result.reason ?? "");
  if (looksLikeHarnessUsageFailure(reason)) {
    return true;
  }

  const [stdout, stderr] = await Promise.all([
    readLogSample(cwd, result.stdoutPath),
    readLogSample(cwd, result.stderrPath)
  ]);
  const joined = `${stdout}\n${stderr}`.trim();
  if (!joined) {
    return false;
  }

  if (!looksLikeHarnessUsageFailure(joined)) {
    return false;
  }

  const noChanges = !Array.isArray(result.changedFiles) || result.changedFiles.length === 0;
  return noChanges;
}

function hasMeasuredDimension(record) {
  const values = Object.values(record.dimensionProvenance ?? {});
  return values.some((value) => value === "measured");
}

async function listRunIds(cwd) {
  const root = path.join(cwd, RUNS_ROOT);
  const entries = await fs.readdir(root).catch(() => []);
  const ranked = await Promise.all(
    entries.map(async (entry) => {
      const reportPath = path.join(root, entry, "report.json");
      const stat = await fs.stat(reportPath).catch(() => null);
      return stat ? { entry, mtimeMs: stat.mtimeMs } : null;
    })
  );
  const filtered = ranked.filter((item) => item !== null).sort((a, b) => b.mtimeMs - a.mtimeMs);
  return filtered.map((item) => item.entry);
}

async function loadRunReport(cwd, runId) {
  const runReportPath = path.join(cwd, RUNS_ROOT, runId, "report.json");
  const raw = await fs.readFile(runReportPath, "utf8");
  return {
    runReportPath,
    runReport: JSON.parse(raw)
  };
}

function hasSyncableResult(runReport, competitorSet) {
  const competitors = Array.isArray(competitorSet.competitors) ? competitorSet.competitors : [];
  for (const result of runReport.results ?? []) {
    const mappedId = COMPETITOR_ID_MAP.get(result.competitor);
    if (!mappedId || !result.measured) continue;
    if (competitors.some((item) => item.id === mappedId)) {
      return true;
    }
  }
  return false;
}

async function main() {
  const cwd = process.cwd();
  const explicitRunId = parseArg("--run");
  const write = hasFlag("--write");
  const setPath = path.join(cwd, COMPETITOR_SET_PATH);
  const competitorSet = JSON.parse(await fs.readFile(setPath, "utf8"));
  if (Array.isArray(competitorSet.competitors)) {
    competitorSet.competitors = competitorSet.competitors.map((item) => withDimensionDefaults(item));
  }
  const runIds = await listRunIds(cwd);

  if (runIds.length === 0) {
    throw new Error("No competitor benchmark run found. Run `salacia benchmark measure` first.");
  }

  let runId = explicitRunId;
  let runReportPath;
  let runReport;
  if (runId) {
    ({ runReportPath, runReport } = await loadRunReport(cwd, runId));
  } else {
    for (const candidate of runIds) {
      const loaded = await loadRunReport(cwd, candidate);
      if (!hasSyncableResult(loaded.runReport, competitorSet)) {
        continue;
      }
      runId = candidate;
      runReportPath = loaded.runReportPath;
      runReport = loaded.runReport;
      break;
    }
  }

  if (!runId || !runReportPath || !runReport) {
    throw new Error("No run with syncable measured results found. Use --run <id> to force a specific run.");
  }

  const updates = [];
  const skipped = [];
  for (const result of runReport.results ?? []) {
    const mappedId = COMPETITOR_ID_MAP.get(result.competitor);
    if (!mappedId) {
      skipped.push({ competitor: result.competitor, reason: "no-competitor-set-mapping" });
      continue;
    }
    const target = (competitorSet.competitors ?? []).find((item) => item.id === mappedId);
    if (!target) {
      skipped.push({ competitor: result.competitor, reason: "competitor-not-found-in-set" });
      continue;
    }
    if (!result.measured) {
      skipped.push({ competitor: result.competitor, reason: "result-not-measured" });
      continue;
    }

    target.sampledAt = toDateOnly(runReport.generatedAt ?? new Date().toISOString());

    const harnessUsageFailure = await isHarnessUsageFailure(result, cwd);
    if (isEnvironmentFailure(result) || harnessUsageFailure) {
      for (const dimension of TASK_MEASURED_DIMENSIONS) {
        target.dimensions[dimension] = null;
        target.dimensionProvenance[dimension] = "unavailable";
      }
      target.provenance = hasMeasuredDimension(target) ? "measured" : "profiled";
    } else {
      const scores = computeMeasuredDimensionScores(result);
      target.provenance = "measured";
      for (const dimension of TASK_MEASURED_DIMENSIONS) {
        target.dimensionProvenance[dimension] = "measured";
        target.dimensions[dimension] = scores[dimension];
      }
    }

    const evidenceRefs = new Set(Array.isArray(target.evidenceRefs) ? target.evidenceRefs : []);
    evidenceRefs.add(path.relative(cwd, runReportPath));
    if (result.stdoutPath) evidenceRefs.add(path.relative(cwd, result.stdoutPath));
    if (result.stderrPath) evidenceRefs.add(path.relative(cwd, result.stderrPath));
    target.evidenceRefs = Array.from(evidenceRefs);

    updates.push({
      competitor: result.competitor,
      mappedId,
      provenance: target.provenance,
      execution_governance: target.dimensions.execution_governance,
      execution_governance_provenance: target.dimensionProvenance.execution_governance,
      prompt_quality: target.dimensions.prompt_quality,
      prompt_quality_provenance: target.dimensionProvenance.prompt_quality,
      contract_integrity: target.dimensions.contract_integrity,
      contract_integrity_provenance: target.dimensionProvenance.contract_integrity
    });
  }

  if (write) {
    await fs.writeFile(setPath, `${JSON.stringify(competitorSet, null, 2)}\n`, "utf8");
  }

  const report = {
    ok: true,
    runId,
    mode: write ? "write" : "dry-run",
    competitorSetPath: COMPETITOR_SET_PATH,
    runReportPath: path.relative(cwd, runReportPath),
    updated: updates,
    skipped
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error.message
      },
      null,
      2
    )
  );
  process.exit(1);
});
