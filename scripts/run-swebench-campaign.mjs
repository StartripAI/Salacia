#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SUPPORTED_GROUPS = ["scaffold", "bare", "both"];
const SUPPORTED_BACKENDS = ["codex", "claude", "aider", "gemini"];
const SUPPORTED_REAL_SINGLE_SUITES = ["swebench_verified_real_single", "swebench_pro_real_single"];

function parseArg(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function parseJsonLine(raw) {
  const trimmed = String(raw).trim();
  if (trimmed) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // continue line-wise extraction
    }
  }

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

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeGroup(value) {
  const normalized = String(value ?? "both").trim().toLowerCase();
  if (["scaffold", "bare", "both"].includes(normalized)) {
    return normalized;
  }
  throw new Error("Invalid --group. Use scaffold|bare|both.");
}

function normalizeBackend(value, argName = "--backend") {
  const normalized = String(value ?? "codex").trim().toLowerCase();
  if (SUPPORTED_BACKENDS.includes(normalized)) {
    return normalized;
  }
  throw new Error(`Invalid ${argName}. Use codex|claude|aider|gemini.`);
}

function normalizeOptionalValue(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeModelChainValue(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function parseRate(raw, argName) {
  const parsed = Number.parseFloat(String(raw));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`Invalid ${argName}. Must be a number in [0,1].`);
  }
  return parsed;
}

function normalizeGroupRuntime(state) {
  const fallbackBackend = normalizeBackend(state?.backend ?? "codex", "state.backend");
  const fallbackModel = normalizeOptionalValue(state?.model ?? null);
  const fallbackModelChain = normalizeModelChainValue(state?.modelChain ?? "");

  const runtimeInput = state?.groupRuntime && typeof state.groupRuntime === "object"
    ? state.groupRuntime
    : {};

  function normalizeRuntimeEntry(raw, groupName) {
    const entry = raw && typeof raw === "object" ? raw : {};
    return {
      backend: normalizeBackend(entry.backend ?? fallbackBackend, `groupRuntime.${groupName}.backend`),
      model: normalizeOptionalValue(entry.model ?? fallbackModel),
      modelChain: normalizeModelChainValue(entry.modelChain ?? fallbackModelChain)
    };
  }

  return {
    scaffold: normalizeRuntimeEntry(runtimeInput.scaffold, "scaffold"),
    bare: normalizeRuntimeEntry(runtimeInput.bare, "bare")
  };
}

function sanitizeRunId(value) {
  return String(value)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
}

function isPass(record) {
  return Boolean(record?.ok) && record?.status === "pass";
}

function classifyStatus(runResult, suiteResult) {
  if (suiteResult?.status) return suiteResult.status;
  if (!runResult.ok) {
    const text = `${runResult.stderr}\n${runResult.stdout}`.toLowerCase();
    if (text.includes("timeout")) return "timeout";
    if (text.includes("unavailable")) return "unavailable";
    return "error";
  }
  return runResult.ok ? "pass" : "error";
}

async function runCommandResult(cmd, args, cwd, timeoutMs = 30_000) {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024
    });
    return {
      ok: true,
      output: `${stdout}\n${stderr}`.trim()
    };
  } catch (error) {
    return {
      ok: false,
      output: `${String(error?.stdout ?? "")}\n${String(error?.stderr ?? "")}\n${String(error?.message ?? "")}`.trim()
    };
  }
}

async function checkDockerDaemon(cwd) {
  const checker = process.platform === "win32" ? "where" : "which";
  const dockerBinary = await runCommandResult(checker, ["docker"], cwd, 10_000);
  if (!dockerBinary.ok) {
    return {
      ok: false,
      reason: "docker binary not found"
    };
  }

  const dockerInfo = await runCommandResult("docker", ["info"], cwd, 30_000);
  if (!dockerInfo.ok) {
    return {
      ok: false,
      reason: "docker daemon unavailable: Command failed: docker info",
      detail: dockerInfo.output
    };
  }

  return {
    ok: true,
    reason: "docker daemon reachable"
  };
}

function summarizeState(state) {
  const groupRuntime = normalizeGroupRuntime(state);
  const byGroup = {
    scaffold: { total: 0, pass: 0, fail: 0, blocked: 0, timeout: 0, unavailable: 0, error: 0 },
    bare: { total: 0, pass: 0, fail: 0, blocked: 0, timeout: 0, unavailable: 0, error: 0 }
  };

  for (const item of state.results) {
    const group = item.group === "bare" ? "bare" : "scaffold";
    byGroup[group].total += 1;
    if (item.status === "pass") byGroup[group].pass += 1;
    else if (item.status === "fail") byGroup[group].fail += 1;
    else if (item.status === "blocked") byGroup[group].blocked += 1;
    else if (item.status === "timeout") byGroup[group].timeout += 1;
    else if (item.status === "unavailable") byGroup[group].unavailable += 1;
    else byGroup[group].error += 1;
  }

  const expectedTotal = state.tasksTotal;
  const completed = state.completedKeys.length;
  const pending = Math.max(0, expectedTotal - completed);

  const groupedByInstance = new Map();
  for (const item of state.results) {
    const key = item.instanceId;
    const current = groupedByInstance.get(key) ?? {};
    current[item.group] = item;
    groupedByInstance.set(key, current);
  }

  let pairedSampleSize = 0;
  let pairComplete = 0;
  let wins = 0;
  let losses = 0;
  let ties = 0;

  if (state.groupMode === "both") {
    pairedSampleSize = state.sampleCount;
    for (const [, pair] of groupedByInstance) {
      if (!pair.scaffold || !pair.bare) {
        continue;
      }
      pairComplete += 1;
      const scaffoldPass = isPass(pair.scaffold);
      const barePass = isPass(pair.bare);
      if (scaffoldPass && !barePass) wins += 1;
      else if (!scaffoldPass && barePass) losses += 1;
      else ties += 1;
    }
  }

  return {
    campaignId: state.campaignId,
    suiteId: state.suiteId ?? "swebench_verified_real_single",
    sampleId: state.sampleId,
    samplePath: state.samplePath,
    groupMode: state.groupMode,
    groupRuntime,
    sampleCount: state.sampleCount,
    expectedTotal,
    completed,
    pending,
    completionRate: expectedTotal > 0 ? completed / expectedTotal : 0,
    byGroup,
    paired: {
      pairedSampleSize,
      pairComplete,
      pairCompleteRate: pairedSampleSize > 0 ? pairComplete / pairedSampleSize : 0,
      wins,
      losses,
      ties
    },
    updatedAt: nowIso()
  };
}

async function saveJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
}

async function loadSample(samplePath) {
  const payload = JSON.parse(await fs.readFile(samplePath, "utf8"));
  if (!payload || !Array.isArray(payload.instances)) {
    throw new Error("Invalid sample file: missing instances[]");
  }
  if (payload.instances.length === 0) {
    throw new Error("Sample file has zero instances");
  }

  const normalizedInstances = payload.instances.map((row, index) => {
    const instanceId = String(row.instance_id ?? row.instanceId ?? "").trim();
    if (!instanceId) {
      throw new Error(`Sample instance at index ${index} missing instance_id`);
    }
    const instanceIndex = Number.isFinite(row.instanceIndex)
      ? row.instanceIndex
      : Number.parseInt(String(row.instanceIndex ?? ""), 10);
    return {
      instanceId,
      instanceIndex: Number.isFinite(instanceIndex) && instanceIndex >= 1 ? instanceIndex : index + 1,
      repo: String(row.repo ?? "").trim() || null,
      stratum: String(row.stratum ?? row.repo ?? "").trim() || null
    };
  });

  return {
    dataset: payload.dataset ?? "SWE-bench/SWE-bench_Verified",
    split: payload.split ?? "test",
    seed: payload.seed ?? null,
    sampleId: String(payload.sampleId ?? `sample-${Date.now()}`),
    count: Number.isFinite(payload.count) ? payload.count : normalizedInstances.length,
    instances: normalizedInstances
  };
}

function buildTasks(sample, groupMode, groupRuntime) {
  const tasks = [];
  const groups = groupMode === "both" ? ["scaffold", "bare"] : [groupMode];

  for (const instance of sample.instances) {
    for (const group of groups) {
      const runtime = group === "bare" ? groupRuntime.bare : groupRuntime.scaffold;
      const key = `${group}:${instance.instanceId}`;
      tasks.push({
        key,
        group,
        backend: runtime.backend,
        model: runtime.model,
        modelChain: runtime.modelChain,
        noScaffold: group === "bare",
        instanceId: instance.instanceId,
        instanceIndex: instance.instanceIndex,
        sampleId: sample.sampleId
      });
    }
  }

  return tasks;
}

async function runSingleTask({ cwd, runnerPath, suiteId, timeoutMs, localRetryMax, campaignId }, task) {
  const runId = sanitizeRunId(`${campaignId}-${task.instanceIndex}-${task.group}`);
  const args = [
    runnerPath,
    "--suite",
    suiteId,
    "--backend",
    task.backend,
    "--instance",
    task.instanceId,
    "--group",
    task.group,
    "--sample-id",
    task.sampleId,
    "--instance-index",
    String(task.instanceIndex),
    "--run-id",
    runId,
    "--timeout-ms",
    String(timeoutMs),
    "--local-retry-max",
    String(localRetryMax)
  ];
  if (task.modelChain && task.modelChain.trim().length > 0) {
    args.push("--model-chain", task.modelChain.trim());
  }
  if (task.noScaffold) {
    args.push("--no-scaffold");
  }
  if (task.model && task.model.trim().length > 0) {
    args.push("--model", task.model.trim());
  }

  const startedAt = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync("node", args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024
    });

    const payload = parseJsonLine(`${stdout}\n${stderr}`) ?? {};
    const suiteResult = Array.isArray(payload.results) ? payload.results[0] : null;
    const resolvedModelChain = Array.isArray(payload.modelChain)
      ? payload.modelChain
      : String(task.modelChain || "").split(",").map((item) => item.trim()).filter((item) => item.length > 0);

    return {
      key: task.key,
      suiteId,
      instanceId: task.instanceId,
      instanceIndex: task.instanceIndex,
      group: task.group,
      backend: task.backend,
      runId: payload.runId ?? runId,
      sampleId: task.sampleId,
      scaffoldEnabled: !task.noScaffold,
      modelChain: resolvedModelChain,
      selectedModel: suiteResult?.selectedModel ?? payload.selectedModel ?? null,
      modelProbeEvidence: suiteResult?.modelProbeEvidence ?? payload.modelProbeEvidence ?? null,
      status: classifyStatus({ ok: true, stdout, stderr }, suiteResult),
      ok: Boolean(suiteResult?.ok),
      reason: suiteResult?.reason ?? "",
      durationMs: Date.now() - startedAt,
      startedAt: new Date(startedAt).toISOString(),
      endedAt: nowIso(),
      exitCode: 0,
      result: suiteResult,
      stderr: String(stderr || "")
    };
  } catch (error) {
    const code = typeof error?.code === "number" ? error.code : 1;
    const stdout = String(error?.stdout ?? "");
    const stderr = String(error?.stderr ?? "");
    const payload = parseJsonLine(`${stdout}\n${stderr}`);
    const suiteResult = payload && Array.isArray(payload.results) ? payload.results[0] : null;
    const resolvedModelChain = payload && Array.isArray(payload.modelChain)
      ? payload.modelChain
      : String(task.modelChain || "").split(",").map((item) => item.trim()).filter((item) => item.length > 0);

    return {
      key: task.key,
      suiteId,
      instanceId: task.instanceId,
      instanceIndex: task.instanceIndex,
      group: task.group,
      backend: task.backend,
      runId: payload?.runId ?? runId,
      sampleId: task.sampleId,
      scaffoldEnabled: !task.noScaffold,
      modelChain: resolvedModelChain,
      selectedModel: suiteResult?.selectedModel ?? payload?.selectedModel ?? null,
      modelProbeEvidence: suiteResult?.modelProbeEvidence ?? payload?.modelProbeEvidence ?? null,
      status: classifyStatus({ ok: false, stdout, stderr }, suiteResult),
      ok: Boolean(suiteResult?.ok),
      reason: suiteResult?.reason ?? String(error?.message ?? "task execution failed"),
      durationMs: Date.now() - startedAt,
      startedAt: new Date(startedAt).toISOString(),
      endedAt: nowIso(),
      exitCode: code,
      result: suiteResult,
      stderr: `${stderr}\n${String(error?.message ?? "")}`.trim()
    };
  }
}

async function main() {
  const cwd = process.cwd();
  const sampleArg = parseArg("--sample", undefined);
  const requestedSuiteId = String(parseArg("--suite", "swebench_verified_real_single") ?? "swebench_verified_real_single").trim();
  const requestedGroupMode = normalizeGroup(parseArg("--group", "both"));
  const requestedTimeoutMs = Number.parseInt(parseArg("--timeout-ms", "3600000"), 10);
  const requestedConcurrency = Number.parseInt(parseArg("--concurrency", "2"), 10);
  const requestedBackend = normalizeBackend(parseArg("--backend", "codex"), "--backend");
  const requestedScaffoldBackend = parseArg("--scaffold-backend", undefined);
  const requestedBareBackend = parseArg("--bare-backend", undefined);
  const requestedModel = parseArg("--model", undefined);
  const requestedScaffoldModel = parseArg("--scaffold-model", undefined);
  const requestedBareModel = parseArg("--bare-model", undefined);
  const requestedModelChain = normalizeModelChainValue(parseArg("--model-chain", undefined));
  const requestedScaffoldModelChain = normalizeModelChainValue(parseArg("--scaffold-model-chain", undefined));
  const requestedBareModelChain = normalizeModelChainValue(parseArg("--bare-model-chain", undefined));
  const requestedLocalRetryMax = Number.parseInt(parseArg("--local-retry-max", process.env.SALACIA_LOCAL_RETRY_MAX ?? "0"), 10);
  const requestedStrictMinModelAttemptedRate = parseRate(
    parseArg("--strict-min-model-attempted-rate", process.env.SALACIA_STRICT_MIN_MODEL_ATTEMPTED_RATE ?? "0.9"),
    "--strict-min-model-attempted-rate"
  );
  const outputJsonArg = parseArg("--output-json", path.join("reports", "swebench_100_results.json"));
  const outputMdArg = parseArg("--output-md", path.join("reports", "swebench_100_results.md"));
  const limitArg = parseArg("--limit", undefined);
  const requestedLimit = limitArg ? Number.parseInt(limitArg, 10) : undefined;
  const resumeId = parseArg("--resume", undefined);
  const resumeOverride = hasFlag("--resume-override");
  const runnerArg = parseArg("--runner", undefined);
  const runnerPath = path.resolve(runnerArg ?? path.join("scripts", "public-benchmark-runner.mjs"));
  const campaignArg = parseArg("--campaign", undefined);
  const campaignId = resumeId ? resumeId.trim() : (campaignArg ? campaignArg.trim() : randomId("swebench100"));
  const campaignDir = path.join(cwd, ".salacia", "journal", "bench", "public", "campaigns", campaignId);
  const statePath = path.join(campaignDir, "campaign.state.json");
  const summaryPartialPath = path.join(campaignDir, "summary.partial.json");
  const summaryFinalPath = path.join(campaignDir, "summary.final.json");

  const existingState = JSON.parse(await fs.readFile(statePath, "utf8").catch(() => "null"));
  const hasResumeState = Boolean(existingState && resumeId);
  const lockConfigToState = hasResumeState && !resumeOverride;

  const groupMode = lockConfigToState
    ? normalizeGroup(String(existingState.groupMode ?? requestedGroupMode))
    : requestedGroupMode;
  const suiteId = lockConfigToState
    ? String(existingState.suiteId ?? requestedSuiteId).trim()
    : requestedSuiteId;
  const timeoutMs = lockConfigToState
    ? Number.parseInt(String(existingState.timeoutMs ?? requestedTimeoutMs), 10)
    : requestedTimeoutMs;
  const concurrency = lockConfigToState
    ? Number.parseInt(String(existingState.concurrency ?? requestedConcurrency), 10)
    : requestedConcurrency;
  const requestedRuntime = {
    scaffold: {
      backend: normalizeBackend(
        requestedScaffoldBackend ?? requestedBackend,
        requestedScaffoldBackend ? "--scaffold-backend" : "--backend"
      ),
      model: normalizeOptionalValue(requestedScaffoldModel ?? requestedModel),
      modelChain: requestedScaffoldModelChain || requestedModelChain
    },
    bare: {
      backend: normalizeBackend(
        requestedBareBackend ?? requestedBackend,
        requestedBareBackend ? "--bare-backend" : "--backend"
      ),
      model: normalizeOptionalValue(requestedBareModel ?? requestedModel),
      modelChain: requestedBareModelChain || requestedModelChain
    }
  };
  const groupRuntime = lockConfigToState
    ? normalizeGroupRuntime(existingState)
    : requestedRuntime;
  const runtimeState = lockConfigToState
    ? {
      backend: normalizeBackend(existingState?.backend ?? requestedBackend, "state.backend"),
      model: normalizeOptionalValue(existingState?.model ?? null),
      modelChain: normalizeModelChainValue(existingState?.modelChain ?? "")
    }
    : {
      backend: requestedBackend,
      model: normalizeOptionalValue(requestedModel),
      modelChain: requestedModelChain
    };
  const localRetryMax = lockConfigToState
    ? Number.parseInt(String(existingState.localRetryMax ?? requestedLocalRetryMax), 10)
    : requestedLocalRetryMax;
  const strictMinModelAttemptedRate = lockConfigToState
    ? parseRate(
      existingState?.strictMinModelAttemptedRate ?? requestedStrictMinModelAttemptedRate,
      "state.strictMinModelAttemptedRate"
    )
    : requestedStrictMinModelAttemptedRate;

  if (!Number.isFinite(timeoutMs) || timeoutMs < 10_000) {
    throw new Error("Invalid --timeout-ms. Must be >= 10000.");
  }
  if (!SUPPORTED_REAL_SINGLE_SUITES.includes(suiteId)) {
    throw new Error("Invalid --suite. Use swebench_verified_real_single|swebench_pro_real_single.");
  }
  if (!Number.isFinite(concurrency) || concurrency < 1 || concurrency > 16) {
    throw new Error("Invalid --concurrency. Must be in [1,16].");
  }
  if (!Number.isFinite(localRetryMax) || localRetryMax < 0 || localRetryMax > 3) {
    throw new Error("Invalid --local-retry-max. Must be in [0,3].");
  }

  const samplePath = sampleArg
    ? path.resolve(sampleArg)
    : existingState?.samplePath
      ? path.resolve(existingState.samplePath)
      : null;

  if (!samplePath) {
    throw new Error("public-campaign requires --sample <path> unless using --resume with existing state");
  }

  const sample = await loadSample(samplePath);
  if (requestedLimit && requestedLimit > 0) {
    sample.instances = sample.instances.slice(0, requestedLimit);
    sample.count = sample.instances.length;
  }
  const tasks = buildTasks(sample, groupMode, groupRuntime);

  const state = hasResumeState
    ? {
      ...existingState,
      updatedAt: nowIso()
    }
    : {
      campaignId,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      samplePath,
      sampleId: sample.sampleId,
      sampleCount: sample.instances.length,
      suiteId,
      groupMode,
      backend: runtimeState.backend,
      model: runtimeState.model,
      modelChain: runtimeState.modelChain,
      groupRuntime,
      localRetryMax,
      strictMinModelAttemptedRate,
      timeoutMs,
      concurrency,
      tasksTotal: tasks.length,
      completedKeys: [],
      results: []
    };

  // Keep runtime configuration explicit in state for reproducible resume behavior.
  state.samplePath = samplePath;
  state.sampleId = sample.sampleId;
  state.sampleCount = sample.instances.length;
  state.suiteId = suiteId;
  state.groupMode = groupMode;
  state.backend = runtimeState.backend;
  state.model = runtimeState.model;
  state.modelChain = runtimeState.modelChain;
  state.groupRuntime = groupRuntime;
  state.localRetryMax = localRetryMax;
  state.strictMinModelAttemptedRate = strictMinModelAttemptedRate;
  state.timeoutMs = timeoutMs;
  state.concurrency = concurrency;
  state.tasksTotal = tasks.length;

  const completed = new Set(Array.isArray(state.completedKeys) ? state.completedKeys : []);
  const resultByKey = new Map(
    (Array.isArray(state.results) ? state.results : [])
      .filter((item) => item && typeof item.key === "string")
      .map((item) => [item.key, item])
  );

  const pendingTasks = tasks.filter((task) => !completed.has(task.key));

  const usingDefaultRunner = !runnerArg || runnerArg.trim().length === 0;
  const shouldRunDockerPreflight = pendingTasks.length > 0
    && usingDefaultRunner
    && !hasFlag("--skip-docker-preflight");
  if (shouldRunDockerPreflight) {
    const docker = await checkDockerDaemon(cwd);
    if (!docker.ok) {
      throw new Error(docker.reason);
    }
  }

  await fs.mkdir(campaignDir, { recursive: true });
  await saveJson(statePath, state);
  await saveJson(summaryPartialPath, summarizeState(state));

  let cursor = 0;
  const workerCount = Math.min(concurrency, Math.max(1, pendingTasks.length));

  async function persistProgress() {
    state.completedKeys = [...completed].sort();
    state.results = [...resultByKey.values()].sort((a, b) => {
      if (a.instanceIndex === b.instanceIndex) {
        return a.group.localeCompare(b.group);
      }
      return a.instanceIndex - b.instanceIndex;
    });
    state.updatedAt = nowIso();
    await saveJson(statePath, state);
    await saveJson(summaryPartialPath, summarizeState(state));
  }

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= pendingTasks.length) {
        return;
      }

      const task = pendingTasks[index];
      const result = await runSingleTask(
        {
          cwd,
          runnerPath,
          suiteId,
          timeoutMs,
          localRetryMax,
          campaignId
        },
        task
      );

      completed.add(task.key);
      resultByKey.set(task.key, result);
      await persistProgress();
    }
  }

  if (pendingTasks.length > 0) {
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  }

  const finalSummary = summarizeState(state);
  await saveJson(summaryFinalPath, finalSummary);

  const analysisJsonPath = path.resolve(cwd, outputJsonArg);
  const analysisMdPath = path.resolve(cwd, outputMdArg);
  await fs.mkdir(path.dirname(analysisJsonPath), { recursive: true });
  await fs.mkdir(path.dirname(analysisMdPath), { recursive: true });

  const analyzeArgs = [
    path.join("scripts", "swebench-analyze.mjs"),
    "--campaign",
    campaignDir,
    "--output-json",
    analysisJsonPath,
    "--output-md",
    analysisMdPath
  ];

  const analyze = await execFileAsync("node", analyzeArgs, {
    cwd,
    maxBuffer: 16 * 1024 * 1024
  }).catch((error) => ({
    stdout: String(error?.stdout ?? ""),
    stderr: `${String(error?.stderr ?? "")}\n${String(error?.message ?? "")}`
  }));

  const analyzePayload = parseJsonLine(`${analyze.stdout}\n${analyze.stderr}`);

  const runtimeBackends = new Set([
    groupRuntime.scaffold.backend,
    groupRuntime.bare.backend
  ]);
  const payloadBackend = runtimeBackends.size === 1 ? [...runtimeBackends][0] : "mixed";

  const payload = {
    ok: true,
    campaignId,
    campaignDir,
    resumeLockedConfig: lockConfigToState,
    resumeOverrideApplied: hasResumeState && resumeOverride,
    samplePath,
    sampleId: sample.sampleId,
    suiteId,
    groupMode,
    backend: payloadBackend,
    groupRuntime,
    model: runtimeState.model,
    modelChain: runtimeState.modelChain
      ? runtimeState.modelChain.split(",").map((item) => item.trim()).filter((item) => item.length > 0)
      : [],
    localRetryMax,
    strictMinModelAttemptedRate,
    timeoutMs,
    concurrency,
    pendingBefore: pendingTasks.length,
    completed: state.completedKeys.length,
    summaryFinalPath,
    summaryPartialPath,
    reports: {
      json: analysisJsonPath,
      md: analysisMdPath,
      analyze: analyzePayload
    },
    finalSummary
  };

  console.log(JSON.stringify(payload, null, 2));

  if (hasFlag("--strict")) {
    const strictFailures = [];
    const pairCompleteRate = Number(finalSummary?.paired?.pairCompleteRate ?? 0);
    if (groupMode === "both" && pairCompleteRate < 0.95) {
      strictFailures.push(`pairCompleteRate ${pairCompleteRate.toFixed(4)} < 0.9500`);
    }

    const analyzeReport = analyzePayload && typeof analyzePayload === "object"
      ? analyzePayload.report
      : null;
    const modelAttemptedRate = Number(analyzeReport?.executionContext?.modelAttemptedRate ?? Number.NaN);
    if (!Number.isFinite(modelAttemptedRate)) {
      strictFailures.push("modelAttemptedRate unavailable from analyze report");
    } else if (modelAttemptedRate < strictMinModelAttemptedRate) {
      strictFailures.push(
        `modelAttemptedRate ${modelAttemptedRate.toFixed(4)} < ${strictMinModelAttemptedRate.toFixed(4)}`
      );
    }

    if (strictFailures.length > 0) {
      console.error(
        JSON.stringify(
          {
            ok: false,
            error: "strict gate failed",
            strictFailures,
            strictContext: {
              campaignId,
              groupMode,
              pairCompleteRate,
              strictMinModelAttemptedRate,
              modelAttemptedRate: Number.isFinite(modelAttemptedRate) ? modelAttemptedRate : null
            }
          },
          null,
          2
        )
      );
      process.exit(1);
    }
  }
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
