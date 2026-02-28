#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

function normalizeBackend(value, fallback = "codex") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["codex", "claude", "aider"].includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function normalizeGroupRuntime(state) {
  const fallbackBackend = normalizeBackend(state?.backend, "codex");
  const fallbackModel = typeof state?.model === "string" && state.model.trim().length > 0 ? state.model.trim() : null;
  const fallbackModelChain = typeof state?.modelChain === "string" ? state.modelChain.trim() : "";
  const runtime = state?.groupRuntime && typeof state.groupRuntime === "object" ? state.groupRuntime : {};

  function normalizeEntry(raw) {
    const entry = raw && typeof raw === "object" ? raw : {};
    return {
      backend: normalizeBackend(entry.backend, fallbackBackend),
      model: typeof entry.model === "string" && entry.model.trim().length > 0 ? entry.model.trim() : fallbackModel,
      modelChain: typeof entry.modelChain === "string" ? entry.modelChain.trim() : fallbackModelChain
    };
  }

  return {
    scaffold: normalizeEntry(runtime.scaffold),
    bare: normalizeEntry(runtime.bare)
  };
}

function parseArg(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function parseJsonLine(raw) {
  const lines = String(raw)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}"));

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      continue;
    }
  }
  return null;
}

function isPass(record) {
  return Boolean(record?.ok) && record?.status === "pass";
}

function retriesAttempted(record) {
  const raw = record?.result?.metrics?.retriesAttempted;
  const parsed = Number.parseInt(String(raw ?? "0"), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function passAtK(rows, k) {
  const maxRetries = Math.max(0, k - 1);
  return rows.filter((row) => isPass(row) && retriesAttempted(row) <= maxRetries).length;
}

const FAILURE_BUCKETS = ["model-fail", "infra-block", "contract-block", "rollback-fail", "eval-fail"];

function normalizeReason(row) {
  return String(row?.reason ?? row?.result?.reason ?? "").trim();
}

function hasInfraReasonSignal(reasonLower) {
  const signals = [
    "rate limit",
    "usage limit",
    "quota",
    "too many requests",
    "not authenticated",
    "authentication",
    "unauthorized",
    "forbidden",
    "api key",
    "missing credentials",
    "provider key",
    "connection refused",
    "network",
    "dns",
    "service unavailable",
    "temporarily unavailable",
    "timed out",
    "timeout",
    "429",
    "401",
    "403"
  ];
  return signals.some((signal) => reasonLower.includes(signal));
}

function classifyFailureCategory(row) {
  const reason = normalizeReason(row);
  const reasonLower = reason.toLowerCase();
  const rowStatus = String(row?.status || "").trim().toLowerCase();
  const metrics = row?.result?.metrics && typeof row.result.metrics === "object"
    ? row.result.metrics
    : {};
  const metricFailureCategory = typeof metrics.failureCategory === "string"
    ? metrics.failureCategory.trim().toLowerCase()
    : "";

  const contractFlag =
    metricFailureCategory === "contract-block"
    || metrics?.contractValidation?.ok === false
    || reasonLower.includes("contract-block")
    || reasonLower.includes("contract validation failed");

  const rollbackFlag =
    metricFailureCategory === "rollback-fail"
    || Number(metrics?.rollback?.failed || 0) > 0
    || reasonLower.includes("rollback-integrity-fail")
    || reasonLower.includes("rollback-fail");

  const evalFlag =
    metricFailureCategory === "eval-fail"
    || reasonLower.includes("swebench evaluation failed")
    || reasonLower.includes("real single-instance evaluation finished")
    || reasonLower.includes("evaluation finished but summary report not found")
    || Number(metrics?.unresolved || 0) > 0
    || Number(metrics?.errors || 0) > 0;

  const infraFlag =
    metricFailureCategory === "infra-block"
    || rowStatus === "blocked"
    || reasonLower.includes("docker daemon unavailable")
    || reasonLower.includes("docker binary not found")
    || reasonLower.includes("docker not found")
    || reasonLower.includes("docker info")
    || reasonLower.includes("python module swebench missing")
    || reasonLower.includes("connector not executable on this host")
    || reasonLower.includes("dataset") && reasonLower.includes("unavailable")
    || hasInfraReasonSignal(reasonLower);

  if (contractFlag) return "contract-block";
  if (rollbackFlag) return "rollback-fail";
  if (infraFlag) return "infra-block";
  if (evalFlag) return "eval-fail";
  return "model-fail";
}

function buildFailureBreakdown(rows, maxReasons = 25) {
  const buckets = Object.fromEntries(FAILURE_BUCKETS.map((bucket) => [bucket, 0]));
  const rawReasonMap = new Map();
  let totalFail = 0;

  for (const row of rows) {
    if (isPass(row)) {
      continue;
    }
    totalFail += 1;
    const category = classifyFailureCategory(row);
    buckets[category] += 1;

    const reason = normalizeReason(row) || "(empty reason)";
    rawReasonMap.set(reason, (rawReasonMap.get(reason) || 0) + 1);
  }

  const rawReasonCounts = [...rawReasonMap.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxReasons)
    .map(([reason, count]) => ({ reason, count }));

  return {
    totalFail,
    buckets,
    rawReasonCounts
  };
}

function comb(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  const kk = Math.min(k, n - k);
  let numerator = 1;
  let denominator = 1;
  for (let i = 1; i <= kk; i += 1) {
    numerator *= (n - kk + i);
    denominator *= i;
  }
  return numerator / denominator;
}

function binomialTwoSidedP(n, kMin) {
  if (n <= 0) return 1;
  let cumulative = 0;
  for (let i = 0; i <= kMin; i += 1) {
    cumulative += comb(n, i);
  }
  const tail = cumulative / (2 ** n);
  return Math.min(1, 2 * tail);
}

function erfApprox(x) {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1 / (1 + p * absX);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return sign * y;
}

function erfcApprox(x) {
  return 1 - erfApprox(x);
}

function mcnemarStats(b, c) {
  const n = b + c;
  if (n === 0) {
    return {
      b,
      c,
      statistic: 0,
      pValue: 1,
      pValueApprox: 1,
      significantAt0_05: false
    };
  }

  const statistic = ((Math.abs(b - c) - 1) ** 2) / n;
  const pValueApprox = erfcApprox(Math.sqrt(statistic / 2));
  const pValue = binomialTwoSidedP(n, Math.min(b, c));
  return {
    b,
    c,
    statistic,
    pValue,
    pValueApprox,
    significantAt0_05: pValue < 0.05
  };
}

function computeReport(state) {
  const results = Array.isArray(state?.results) ? state.results : [];
  const groupRuntime = normalizeGroupRuntime(state);
  const groupLabels = {
    scaffold: `scaffold (${groupRuntime.scaffold.backend})`,
    bare: `bare (${groupRuntime.bare.backend})`
  };

  const scaffold = results.filter((item) => item.group === "scaffold");
  const bare = results.filter((item) => item.group === "bare");

  const scaffoldPass = scaffold.filter(isPass).length;
  const barePass = bare.filter(isPass).length;
  const scaffoldPassAt1 = passAtK(scaffold, 1);
  const scaffoldPassAt2 = passAtK(scaffold, 2);
  const scaffoldPassAt3 = passAtK(scaffold, 3);
  const barePassAt1 = passAtK(bare, 1);
  const barePassAt2 = passAtK(bare, 2);
  const barePassAt3 = passAtK(bare, 3);

  const byInstance = new Map();
  for (const row of results) {
    const key = String(row.instanceId ?? "");
    if (!key) continue;
    const pair = byInstance.get(key) ?? {};
    pair[row.group] = row;
    byInstance.set(key, pair);
  }

  let pairedSampleSize = 0;
  let pairComplete = 0;
  let wins = 0;
  let losses = 0;
  let ties = 0;

  for (const [, pair] of byInstance) {
    pairedSampleSize += 1;
    if (!pair.scaffold || !pair.bare) {
      continue;
    }
    pairComplete += 1;
    const scaffoldResolved = isPass(pair.scaffold);
    const bareResolved = isPass(pair.bare);

    if (scaffoldResolved && !bareResolved) {
      wins += 1;
    } else if (!scaffoldResolved && bareResolved) {
      losses += 1;
    } else {
      ties += 1;
    }
  }

  const b = losses;
  const c = wins;
  const mcnemar = mcnemarStats(b, c);
  const failureBreakdown = {
    overall: buildFailureBreakdown(results),
    byGroup: {
      scaffold: buildFailureBreakdown(scaffold),
      bare: buildFailureBreakdown(bare)
    }
  };
  const infraBlockedRuns = Number(failureBreakdown.overall.buckets["infra-block"] || 0);
  const totalRuns = results.length;
  const modelAttemptedRuns = Math.max(0, totalRuns - infraBlockedRuns);
  const modelAttemptedFailures = Math.max(0, Number(failureBreakdown.overall.totalFail || 0) - infraBlockedRuns);
  const modelAttemptedPasses = Math.max(0, modelAttemptedRuns - modelAttemptedFailures);
  const executionContext = {
    totalRuns,
    infraBlockedRuns,
    modelAttemptedRuns,
    modelAttemptedRate: totalRuns > 0 ? modelAttemptedRuns / totalRuns : 0,
    modelAttemptedPasses,
    modelAttemptedFailures
  };

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    campaignId: state.campaignId,
    campaignDir: state.campaignDir,
    suiteId: state.suiteId ?? "swebench_verified_real_single",
    sampleId: state.sampleId,
    groupRuntime,
    groupLabels,
    officialComparable: false,
    pairedSampleSize,
    pairComplete,
    pairCompleteRate: pairedSampleSize > 0 ? pairComplete / pairedSampleSize : 0,
    scaffold: {
      total: scaffold.length,
      pass: scaffoldPass,
      passRate: scaffold.length > 0 ? scaffoldPass / scaffold.length : 0
    },
    bare: {
      total: bare.length,
      pass: barePass,
      passRate: bare.length > 0 ? barePass / bare.length : 0
    },
    delta: (scaffold.length > 0 ? scaffoldPass / scaffold.length : 0) - (bare.length > 0 ? barePass / bare.length : 0),
    passAtRetry: {
      scaffold: {
        total: scaffold.length,
        passAt1: scaffoldPassAt1,
        passAt2: scaffoldPassAt2,
        passAt3: scaffoldPassAt3,
        rateAt1: scaffold.length > 0 ? scaffoldPassAt1 / scaffold.length : 0,
        rateAt2: scaffold.length > 0 ? scaffoldPassAt2 / scaffold.length : 0,
        rateAt3: scaffold.length > 0 ? scaffoldPassAt3 / scaffold.length : 0
      },
      bare: {
        total: bare.length,
        passAt1: barePassAt1,
        passAt2: barePassAt2,
        passAt3: barePassAt3,
        rateAt1: bare.length > 0 ? barePassAt1 / bare.length : 0,
        rateAt2: bare.length > 0 ? barePassAt2 / bare.length : 0,
        rateAt3: bare.length > 0 ? barePassAt3 / bare.length : 0
      }
    },
    guardianRetryGain: {
      scaffold: scaffold.length > 0 ? (scaffoldPassAt3 - scaffoldPassAt1) / scaffold.length : 0,
      bare: bare.length > 0 ? (barePassAt3 - barePassAt1) / bare.length : 0
    },
    wins,
    losses,
    ties,
    mcnemar,
    failureBreakdown,
    executionContext
  };
}

function renderMarkdown(report) {
  const suiteLabel = report.suiteId === "swebench_pro_real_single" ? "SWE-bench Pro" : "SWE-bench Verified";
  const overall = report.failureBreakdown?.overall || { buckets: {}, rawReasonCounts: [] };
  const byGroup = report.failureBreakdown?.byGroup || {};
  const scaffoldFailures = byGroup.scaffold || { buckets: {}, rawReasonCounts: [] };
  const bareFailures = byGroup.bare || { buckets: {}, rawReasonCounts: [] };
  const groupLabels = report.groupLabels || {
    scaffold: "scaffold",
    bare: "bare"
  };
  const passAtRetry = report.passAtRetry || {
    scaffold: { total: 0, passAt1: 0, passAt2: 0, passAt3: 0, rateAt1: 0, rateAt2: 0, rateAt3: 0 },
    bare: { total: 0, passAt1: 0, passAt2: 0, passAt3: 0, rateAt1: 0, rateAt2: 0, rateAt3: 0 }
  };
  const topOverallReasons = (overall.rawReasonCounts || []).slice(0, 5);
  const context = report.executionContext || {
    totalRuns: 0,
    infraBlockedRuns: 0,
    modelAttemptedRuns: 0,
    modelAttemptedRate: 0,
    modelAttemptedPasses: 0,
    modelAttemptedFailures: 0
  };

  return [
    `# SWE-bench ${Number(report.pairedSampleSize || 0)} Paired Result`,
    "",
    `- Campaign ID: ${report.campaignId}`,
    `- Suite: ${suiteLabel} (${report.suiteId})`,
    `- Generated At: ${report.generatedAt}`,
    `- Sample ID: ${report.sampleId}`,
    `- Pair Complete Rate: ${(report.pairCompleteRate * 100).toFixed(2)}%`,
    "",
    "## Pass Rates",
    "",
    `- ${groupLabels.scaffold}: ${report.scaffold.pass}/${report.scaffold.total} (${(report.scaffold.passRate * 100).toFixed(2)}%)`,
    `- ${groupLabels.bare}: ${report.bare.pass}/${report.bare.total} (${(report.bare.passRate * 100).toFixed(2)}%)`,
    `- Delta: ${(report.delta * 100).toFixed(2)} pp`,
    "",
    "## Pass@Retry",
    "",
    `- ${groupLabels.scaffold} Pass@1: ${passAtRetry.scaffold.passAt1}/${passAtRetry.scaffold.total} (${(passAtRetry.scaffold.rateAt1 * 100).toFixed(2)}%)`,
    `- ${groupLabels.scaffold} Pass@2: ${passAtRetry.scaffold.passAt2}/${passAtRetry.scaffold.total} (${(passAtRetry.scaffold.rateAt2 * 100).toFixed(2)}%)`,
    `- ${groupLabels.scaffold} Pass@3: ${passAtRetry.scaffold.passAt3}/${passAtRetry.scaffold.total} (${(passAtRetry.scaffold.rateAt3 * 100).toFixed(2)}%)`,
    `- ${groupLabels.bare} Pass@1: ${passAtRetry.bare.passAt1}/${passAtRetry.bare.total} (${(passAtRetry.bare.rateAt1 * 100).toFixed(2)}%)`,
    `- ${groupLabels.bare} Pass@2: ${passAtRetry.bare.passAt2}/${passAtRetry.bare.total} (${(passAtRetry.bare.rateAt2 * 100).toFixed(2)}%)`,
    `- ${groupLabels.bare} Pass@3: ${passAtRetry.bare.passAt3}/${passAtRetry.bare.total} (${(passAtRetry.bare.rateAt3 * 100).toFixed(2)}%)`,
    `- Guardian retry gain (${groupLabels.scaffold}, Pass@3 - Pass@1): ${(Number(report.guardianRetryGain?.scaffold || 0) * 100).toFixed(2)} pp`,
    `- Guardian retry gain (${groupLabels.bare}, Pass@3 - Pass@1): ${(Number(report.guardianRetryGain?.bare || 0) * 100).toFixed(2)} pp`,
    "",
    "## Paired Outcome",
    "",
    `- Wins (scaffold-only pass): ${report.wins}`,
    `- Losses (bare-only pass): ${report.losses}`,
    `- Ties: ${report.ties}`,
    "",
    "## McNemar",
    "",
    `- b (scaffold fail -> bare pass): ${report.mcnemar.b}`,
    `- c (scaffold pass -> bare fail): ${report.mcnemar.c}`,
    `- statistic: ${report.mcnemar.statistic.toFixed(6)}`,
    `- p-value (exact): ${report.mcnemar.pValue.toExponential(6)}`,
    `- p-value (approx): ${report.mcnemar.pValueApprox.toExponential(6)}`,
    `- significant@0.05: ${report.mcnemar.significantAt0_05}`,
    "",
    "## Execution Context",
    "",
    `- Total runs: ${context.totalRuns}`,
    `- Infra-blocked runs: ${context.infraBlockedRuns}`,
    `- Model-attempted runs: ${context.modelAttemptedRuns} (${(Number(context.modelAttemptedRate || 0) * 100).toFixed(2)}%)`,
    `- Model-attempted passes: ${context.modelAttemptedPasses}`,
    `- Model-attempted failures: ${context.modelAttemptedFailures}`,
    "",
    "## Failure Breakdown",
    "",
    "### Overall",
    "",
    `- model-fail: ${overall.buckets?.["model-fail"] || 0}`,
    `- infra-block: ${overall.buckets?.["infra-block"] || 0}`,
    `- contract-block: ${overall.buckets?.["contract-block"] || 0}`,
    `- rollback-fail: ${overall.buckets?.["rollback-fail"] || 0}`,
    `- eval-fail: ${overall.buckets?.["eval-fail"] || 0}`,
    "",
    "### By Group",
    "",
    `- Scaffold model-fail: ${scaffoldFailures.buckets?.["model-fail"] || 0}`,
    `- Scaffold infra-block: ${scaffoldFailures.buckets?.["infra-block"] || 0}`,
    `- Scaffold contract-block: ${scaffoldFailures.buckets?.["contract-block"] || 0}`,
    `- Scaffold rollback-fail: ${scaffoldFailures.buckets?.["rollback-fail"] || 0}`,
    `- Scaffold eval-fail: ${scaffoldFailures.buckets?.["eval-fail"] || 0}`,
    `- Bare model-fail: ${bareFailures.buckets?.["model-fail"] || 0}`,
    `- Bare infra-block: ${bareFailures.buckets?.["infra-block"] || 0}`,
    `- Bare contract-block: ${bareFailures.buckets?.["contract-block"] || 0}`,
    `- Bare rollback-fail: ${bareFailures.buckets?.["rollback-fail"] || 0}`,
    `- Bare eval-fail: ${bareFailures.buckets?.["eval-fail"] || 0}`,
    "",
    "### Raw Reasons (Top 5)",
    "",
    ...(topOverallReasons.length > 0
      ? topOverallReasons.map((item) => `- ${item.count} × ${item.reason}`)
      : ["- (none)"]),
    "",
    "Note: officialComparable remains false until official leaderboard submission."
  ].join("\n");
}

async function loadCampaignState(campaignDir) {
  const statePath = path.join(campaignDir, "campaign.state.json");
  const raw = await fs.readFile(statePath, "utf8");
  const state = JSON.parse(raw);
  return {
    ...state,
    campaignDir
  };
}

async function main() {
  const cwd = process.cwd();
  const campaignArg = parseArg("--campaign", undefined);
  const campaignIdArg = parseArg("--campaign-id", undefined);

  let campaignDir = campaignArg ? path.resolve(campaignArg) : null;
  if (!campaignDir && campaignIdArg) {
    campaignDir = path.join(cwd, ".salacia", "journal", "bench", "public", "campaigns", campaignIdArg);
  }
  if (!campaignDir) {
    throw new Error("swebench-analyze requires --campaign <dir> or --campaign-id <id>");
  }

  const outputJson = path.resolve(parseArg("--output-json", path.join("reports", "swebench_100_results.json")));
  const outputMd = path.resolve(parseArg("--output-md", path.join("reports", "swebench_100_results.md")));

  const state = await loadCampaignState(campaignDir);
  const report = computeReport(state);

  await fs.mkdir(path.dirname(outputJson), { recursive: true });
  await fs.mkdir(path.dirname(outputMd), { recursive: true });
  await fs.writeFile(outputJson, JSON.stringify(report, null, 2), "utf8");
  await fs.writeFile(outputMd, renderMarkdown(report), "utf8");

  const payload = {
    ok: true,
    campaignId: report.campaignId,
    campaignDir,
    outputJson,
    outputMd,
    report
  };

  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  const payload = {
    ok: false,
    error: error.message
  };
  console.error(JSON.stringify(payload, null, 2));
  const extracted = parseJsonLine(JSON.stringify(payload));
  if (!extracted) {
    process.exit(1);
  }
  process.exit(1);
});
