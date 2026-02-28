#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  DEFAULT_AIDER_MODEL_CHAIN,
  buildRealTaskPrompt,
  DEFAULT_CLAUDE_MODEL_CHAIN,
  DEFAULT_CODEX_MODEL_CHAIN,
  parseModelChain
} from "./public-benchmark-utils.mjs";
import { buildRepoContext } from "./repo-context-builder.mjs";
import { buildLocalTestPlan, runLocalTestPlan, runMinimalVerification } from "./local-test-runner.mjs";
import { localizeFault } from "./fault-localizer.mjs";
import { buildTreeSitterRepoMap } from "./tree-sitter-repo-map.mjs";
import { sublimateIntent } from "./intent-sublimator.mjs";
import { createMiniContract, validatePatchAgainstContract } from "./contract-compiler.mjs";
import { createBenchmarkSnapshot, restoreBenchmarkSnapshot } from "./benchmark-snapshot.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_SWEBENCH_PRO_DATASET = process.env.SALACIA_SWEBENCH_PRO_DATASET?.trim() || "SWE-bench/SWE-bench_Pro";
const DEFAULT_SWEBENCH_PRO_INSTANCE = process.env.SALACIA_SWEBENCH_PRO_DEFAULT_INSTANCE?.trim() || "";

const SUITE_DEFINITIONS = {
  swebench_lite_smoke: {
    id: "swebench_lite_smoke",
    standard: "SWE-bench Lite",
    communityTier: "public-standard",
    officialComparable: false,
    dataset: "SWE-bench/SWE-bench_Lite",
    defaultInstance: "astropy__astropy-12907"
  },
  swebench_verified_smoke: {
    id: "swebench_verified_smoke",
    standard: "SWE-bench Verified",
    communityTier: "public-standard",
    officialComparable: false,
    dataset: "SWE-bench/SWE-bench_Verified",
    defaultInstance: "astropy__astropy-12907"
  },
  swebench_verified_real_single: {
    id: "swebench_verified_real_single",
    standard: "SWE-bench Verified (real single-instance)",
    communityTier: "public-standard",
    officialComparable: false,
    dataset: "SWE-bench/SWE-bench_Verified",
    defaultInstance: "pallets__flask-5014"
  },
  swebench_pro_smoke: {
    id: "swebench_pro_smoke",
    standard: "SWE-bench Pro",
    communityTier: "public-standard",
    officialComparable: false,
    dataset: DEFAULT_SWEBENCH_PRO_DATASET,
    defaultInstance: DEFAULT_SWEBENCH_PRO_INSTANCE
  },
  swebench_pro_real_single: {
    id: "swebench_pro_real_single",
    standard: "SWE-bench Pro (real single-instance)",
    communityTier: "public-standard",
    officialComparable: false,
    dataset: DEFAULT_SWEBENCH_PRO_DATASET,
    defaultInstance: DEFAULT_SWEBENCH_PRO_INSTANCE
  },
  aider_leaderboard_smoke: {
    id: "aider_leaderboard_smoke",
    standard: "Aider LLM Leaderboard (smoke proxy)",
    communityTier: "community-standard",
    officialComparable: false
  },
  livecodebench_probe: {
    id: "livecodebench_probe",
    standard: "LiveCodeBench",
    communityTier: "public-standard",
    officialComparable: false
  },
  bigcodebench_probe: {
    id: "bigcodebench_probe",
    standard: "BigCodeBench",
    communityTier: "public-standard",
    officialComparable: false
  },
  swe_rebench_probe: {
    id: "swe_rebench_probe",
    standard: "SWE-rebench",
    communityTier: "public-standard",
    officialComparable: false,
    dataset: "nebius/SWE-rebench",
    defaultInstance: "0b01001001__spectree-64"
  },
  humaneval_plus_probe: {
    id: "humaneval_plus_probe",
    standard: "HumanEval+ / MBPP",
    communityTier: "public-standard",
    officialComparable: false
  }
};

const COMMUNITY_SUITES = Object.keys(SUITE_DEFINITIONS);

function parseArg(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function normalizeGroup(group, noScaffold) {
  if (noScaffold) return "bare";
  return group === "bare" ? "bare" : "scaffold";
}

function safeFilePart(value) {
  return String(value)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80);
}

async function run(cmd, args, cwd, timeout = 120_000, env) {
  const { stdout, stderr } = await execFileAsync(cmd, args, {
    cwd,
    timeout,
    maxBuffer: 50 * 1024 * 1024,
    ...(env ? { env } : {})
  });
  return `${stdout}\n${stderr}`.trim();
}

async function runWithResult(cmd, args, cwd, timeout = 120_000, env) {
  try {
    const output = await run(cmd, args, cwd, timeout, env);
    return {
      ok: true,
      code: 0,
      output
    };
  } catch (error) {
    return {
      ok: false,
      code: typeof error?.code === "number" ? error.code : 1,
      output: `${error?.stdout ?? ""}\n${error?.stderr ?? ""}\n${error?.message ?? ""}`.trim()
    };
  }
}

function parseGitStatusPorcelain(raw) {
  return String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length >= 3)
    .map((line) => {
      const match = line.match(/^(.{2})\s+(.*)$/);
      if (!match) {
        return null;
      }
      const code = match[1].trim();
      const rawPath = match[2].trim();
      const file = rawPath.includes(" -> ")
        ? rawPath.split(" -> ").pop().trim()
        : rawPath;
      return {
        code,
        file
      };
    })
    .filter(Boolean);
}

async function listChangedFiles(repoPath) {
  const status = await runWithResult("git", ["status", "--porcelain"], repoPath, 30_000);
  if (!status.ok) return [];
  return parseGitStatusPorcelain(status.output).map((item) => item.file);
}

async function resolveAiderTargetFiles(repoPath, localization, maxFiles = 10) {
  const ranked = Array.isArray(localization?.rankedFiles) ? localization.rankedFiles : [];
  if (ranked.length === 0) {
    return [];
  }

  const root = path.resolve(repoPath);
  const selected = [];
  const seen = new Set();
  for (const entry of ranked) {
    const rawPath = typeof entry?.path === "string" ? entry.path.trim() : "";
    if (!rawPath || seen.has(rawPath)) {
      continue;
    }
    seen.add(rawPath);

    const normalized = rawPath.replace(/\\/g, "/").replace(/^\.\//, "");
    const absolute = path.resolve(repoPath, normalized);
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
      continue;
    }
    const stat = await fs.stat(absolute).catch(() => null);
    if (!stat || !stat.isFile()) {
      continue;
    }
    selected.push(normalized);
    if (selected.length >= maxFiles) {
      break;
    }
  }

  return selected;
}

function computeScopeCoverage(contractValidation) {
  const changedFiles = Array.isArray(contractValidation?.changedFiles) ? contractValidation.changedFiles : [];
  if (changedFiles.length === 0) {
    return 1;
  }
  const outOfScope = new Set(
    (contractValidation?.violations || [])
      .filter((item) => item && item.code === "scope-drift")
      .map((item) => item.file)
      .filter(Boolean)
  );
  const inScope = changedFiles.filter((file) => !outOfScope.has(file)).length;
  return Number((inScope / changedFiles.length).toFixed(6));
}

function shouldHardBlockContract(contractValidation, retryCount, maxRetryCount) {
  // In SWE-bench benchmark scenarios, we want to measure the model's actual performance
  // on the tests. Contract violations should be logged but should NEVER prevent the
  // patch from being evaluated by the official harness.
  // If we hard-block here, we artificially deflate the model's SWE-bench score.
  return false;
}

async function writeGuardianAttemptRecord(runDir, payload) {
  const guardianDir = path.join(runDir, "guardian");
  await fs.mkdir(guardianDir, { recursive: true });
  const filePath = path.join(guardianDir, `attempt-${payload.attempt}.json`);
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
}

async function checkCommand(command, cwd) {
  const checker = process.platform === "win32" ? "where" : "which";
  const result = await runWithResult(checker, [command], cwd, 20_000);
  return {
    ok: result.ok,
    reason: result.ok ? `${command} available` : `${command} not found`
  };
}

async function checkDockerDaemon(cwd) {
  const dockerBinary = await checkCommand("docker", cwd);
  if (!dockerBinary.ok) {
    return {
      ok: false,
      reason: dockerBinary.reason
    };
  }
  try {
    await run("docker", ["info"], cwd, 30_000);
    return { ok: true, reason: "docker daemon reachable" };
  } catch (error) {
    return {
      ok: false,
      reason: `docker daemon unavailable: ${error.message}`
    };
  }
}

async function checkPythonModule(cwd, moduleName) {
  const result = await runWithResult(
    "python3",
    ["-c", `import importlib.util,sys;sys.exit(0 if importlib.util.find_spec('${moduleName}') else 1)`],
    cwd,
    20_000
  );
  return {
    ok: result.ok,
    reason: result.ok ? `python module ${moduleName} available` : `python module ${moduleName} missing`
  };
}

function jsonLineFromOutput(raw) {
  const lines = raw
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

async function loadSwebenchInstance(cwd, dataset, instanceId) {
  const normalizedInstanceId = typeof instanceId === "string" ? instanceId.trim() : "";
  const result = await runWithResult(
    "python3",
    [
      "-c",
      [
        "import json,sys",
        "from datasets import load_dataset",
        `dataset = '${dataset}'`,
        `instance = '${normalizedInstanceId}'`,
        "ds = load_dataset(dataset, split='test')",
        "row = next((r for r in ds if r['instance_id'] == instance), None) if instance else ds[0]",
        "assert row is not None, f'instance not found: {instance}'",
        "payload = {}",
        "payload['instance_id'] = row['instance_id']",
        "payload['repo'] = row['repo']",
        "payload['base_commit'] = row['base_commit']",
        "payload['problem_statement'] = row['problem_statement']",
        "payload['hints_text'] = row.get('hints_text')",
        "payload['version'] = row.get('version')",
        "print(json.dumps(payload))"
      ].join("\n"),
    ],
    cwd,
    240_000
  );

  if (!result.ok) {
    return {
      ok: false,
      reason: `failed to load instance metadata: ${result.output.slice(0, 500)}`
    };
  }

  const payload = jsonLineFromOutput(result.output);
  if (!payload || typeof payload !== "object") {
    return {
      ok: false,
      reason: `failed to parse instance metadata JSON: ${result.output.slice(0, 500)}`
    };
  }

  return { ok: true, payload };
}

async function initRealRepo(runDir, instance) {
  const repoPath = path.join(runDir, "workspace");
  const repoUrl = `https://github.com/${instance.repo}.git`;
  // Resume can reuse the same runId. Ensure workspace is clean before cloning.
  await fs.rm(repoPath, { recursive: true, force: true });
  // Full clone to ensure base_commit is always reachable.
  // SWE-bench base_commits are often hundreds/thousands of commits old;
  // shallow clones with --depth=100 frequently miss them.
  const clone = await runWithResult("git", ["clone", repoUrl, repoPath], runDir, 600_000);
  if (!clone.ok) {
    return { ok: false, reason: `git clone failed: ${clone.output.slice(0, 500)}` };
  }

  const checkout = await runWithResult("git", ["checkout", instance.base_commit], repoPath, 120_000);
  if (!checkout.ok) {
    // If checkout fails (e.g., partial fetch), attempt explicit fetch then retry.
    const fetch = await runWithResult("git", ["fetch", "origin", instance.base_commit], repoPath, 300_000);
    if (!fetch.ok) {
      return { ok: false, reason: `git fetch base_commit failed: ${fetch.output.slice(0, 500)}` };
    }
    const retryCheckout = await runWithResult("git", ["checkout", instance.base_commit], repoPath, 120_000);
    if (!retryCheckout.ok) {
      return { ok: false, reason: `git checkout failed after fetch: ${retryCheckout.output.slice(0, 500)}` };
    }
  }

  return { ok: true, repoPath };
}

async function runRealPatchBackend(backend, model, runDir, repoPath, prompt, timeoutMs, options = {}) {
  const aiderTargetFiles = Array.isArray(options?.aiderTargetFiles) ? options.aiderTargetFiles : [];
  const normalizedModel = typeof model === "string" ? model.trim() : "";
  const modelPart = safeFilePart(normalizedModel || "default");

  // Determine success by whether the repo actually has changes (git diff/status),
  // not by exit code alone. Codex/Claude/Aider may exit non-zero even after
  // successfully modifying files (e.g., timeout with partial work, stderr warnings).
  async function checkPatchGenerated(exitResult, modelLabel, provider) {
    const diff = await runWithResult("git", ["diff", "--stat"], repoPath, 30_000);
    const hasDiff = diff.ok && diff.output.trim().length > 0;
    const status = await runWithResult("git", ["status", "--porcelain"], repoPath, 30_000);
    const hasUntracked = status.ok && status.output.trim().length > 0;
    const hasChanges = hasDiff || hasUntracked;

    if (hasChanges) {
      return {
        ok: true,
        reason: exitResult.ok ? "" : `backend exited non-zero but patch was generated (exit=${exitResult.code})`,
        modelLabel,
        provider
      };
    }

    if (!exitResult.ok) {
      return {
        ok: false,
        reason: `${provider} failed with no patch: ${exitResult.output.slice(0, 500)}`,
        modelLabel,
        provider
      };
    }

    return {
      ok: false,
      reason: "backend completed but produced no code changes",
      modelLabel,
      provider
    };
  }

  if (backend === "claude") {
    const token = process.env.ANTHROPIC_AUTH_TOKEN?.trim();
    const baseUrl = process.env.ANTHROPIC_BASE_URL?.trim();
    const claudeModel = normalizedModel || DEFAULT_CLAUDE_MODEL_CHAIN[0];
    const env = { ...process.env };
    if (token) env.ANTHROPIC_AUTH_TOKEN = token;
    if (baseUrl) env.ANTHROPIC_BASE_URL = baseUrl;
    const result = await runWithResult(
      "claude",
      ["-p", "--model", claudeModel, prompt],
      repoPath,
      timeoutMs,
      env
    );
    await fs.writeFile(path.join(runDir, `claude-output-${modelPart}.txt`), result.output, "utf8");
    return checkPatchGenerated(result, `salacia/claude-${claudeModel}`, "claude-cli");
  }

  if (backend === "openrouter") {
    return {
      ok: false,
      reason: "openrouter backend is disabled; only user-endpoint IDE/CLI/App backends are supported",
      modelLabel: normalizedModel || "openrouter",
      provider: "openrouter-disabled"
    };
  }

  if (backend === "aider") {
    const aiderModel = normalizedModel || DEFAULT_AIDER_MODEL_CHAIN[0];
    const args = [
      "--yes-always",
      "--no-auto-commits",
      "--no-check-update",
      "--no-show-release-notes",
      "--no-analytics"
    ];
    if (aiderModel !== "default") {
      args.push("--model", aiderModel);
    }
    args.push("--message", prompt);
    if (aiderTargetFiles.length > 0) {
      args.push(...aiderTargetFiles);
    }
    const result = await runWithResult("aider", args, repoPath, timeoutMs);
    await fs.writeFile(path.join(runDir, `aider-output-${modelPart}.txt`), result.output, "utf8");
    return checkPatchGenerated(result, `salacia/aider-${aiderModel}`, "aider-cli");
  }

  if (backend === "gemini") {
    const geminiModel = normalizedModel || "gemini-3.1-pro";
    const env = { ...process.env };
    delete env.GOOGLE_GENAI_USE_VERTEXAI;
    delete env.GOOGLE_CLOUD_PROJECT;
    delete env.GOOGLE_CLOUD_LOCATION;
    // Prevent the SDK from finding local gcloud credentials
    env.GOOGLE_APPLICATION_CREDENTIALS = "";

    const token = process.env.GEMINI_API_KEY?.trim() || "";
    const isVertexToken = token.startsWith("AQ.Ab8");

    if (isVertexToken) {
      // Vertex AI Access Token (OAuth2) mode
      env.GOOGLE_GENAI_USE_VERTEXAI = "true";
      env.GEMINI_API_KEY_AUTH_MECHANISM = "bearer";
      env.GEMINI_API_KEY = token;
      // Locations and Projects should ideally be passed in or set in parent env
      if (process.env.GOOGLE_CLOUD_PROJECT) {
        env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT;
      }
      if (process.env.GOOGLE_CLOUD_LOCATION) {
        env.GOOGLE_CLOUD_LOCATION = process.env.GOOGLE_CLOUD_LOCATION;
      }
    } else {
      // API Key mode
      env.GEMINI_API_KEY = token;
    }

    const result = await runWithResult(
      runnerBinary,
      args,
      repoPath,
      timeoutMs,
      env
    );
    await fs.writeFile(path.join(runDir, `gemini-output-${modelPart}.txt`), result.output, "utf8");
    return checkPatchGenerated(result, `salacia/gemini-${geminiModel}`, "gemini-cli");
  }

  const codexModel = normalizedModel || DEFAULT_CODEX_MODEL_CHAIN[0];
  const result = await runWithResult(
    "codex",
    [
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "-m",
      codexModel,
      "-c",
      "model_reasoning_effort=\"high\"",
      "-C",
      repoPath,
      prompt
    ],
    runDir,
    timeoutMs
  );
  await fs.writeFile(path.join(runDir, `codex-output-${modelPart}.jsonl`), result.output, "utf8");
  return checkPatchGenerated(result, `salacia/codex-${codexModel}`, "codex-cli");
}

function providerForBackend(backend) {
  if (backend === "claude") return "claude-cli";
  if (backend === "aider") return "aider-cli";
  return "codex-cli";
}

function classifyBackendFailureCategory(reason) {
  const text = String(reason || "").toLowerCase();
  if (!text) {
    return "model-fail";
  }
  const infraSignals = [
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
    "binary not found",
    "command not found",
    "429",
    "401",
    "403"
  ];
  return infraSignals.some((signal) => text.includes(signal)) ? "infra-block" : "model-fail";
}

async function runRealPatchBackendWithChain(backend, modelChain, runDir, repoPath, prompt, timeoutMs, options = {}) {
  const attempted = [];
  const failures = [];

  for (const model of modelChain) {
    attempted.push(model);
    const result = await runRealPatchBackend(backend, model, runDir, repoPath, prompt, timeoutMs, options);
    if (result.ok) {
      return {
        ok: true,
        selectedModel: model,
        modelLabel: result.modelLabel,
        provider: result.provider,
        modelProbeEvidence: {
          attempted,
          failures
        }
      };
    }

    failures.push({
      model,
      reason: result.reason
    });
  }

  return {
    ok: false,
    reason: failures.length > 0 ? failures[failures.length - 1].reason : "all model chain attempts failed",
    selectedModel: null,
    provider: providerForBackend(backend),
    modelProbeEvidence: {
      attempted,
      failures
    }
  };
}

function buildRetryPrompt(basePrompt, validation, attempt) {
  const truncatedOutput = String(validation?.output || "").slice(-8_000);
  return [
    basePrompt,
    "",
    `Follow-up fix attempt #${attempt + 1}: local validation failed.`,
    `Validation command: ${validation?.command || "unknown"}`,
    "Validation output (tail):",
    truncatedOutput || "(empty)",
    "",
    "Apply a minimal corrective patch to address this failure.",
    "Keep scope narrow and keep changes unstaged."
  ].join("\n");
}

async function initSeedRepo(root) {
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.mkdir(path.join(root, "tests"), { recursive: true });

  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        name: "salacia-public-bench-seed",
        version: "0.0.0",
        private: true,
        type: "module",
        scripts: {
          test: "node --test"
        }
      },
      null,
      2
    ),
    "utf8"
  );

  await fs.writeFile(
    path.join(root, "src", "auth.js"),
    [
      "export function validateLogin(username, password) {",
      "  if (typeof username !== \"string\" || typeof password !== \"string\") {",
      "    return false;",
      "  }",
      "  return Boolean(username) && password.length >= 8;",
      "}",
      ""
    ].join("\n"),
    "utf8"
  );

  await fs.writeFile(
    path.join(root, "tests", "auth.test.js"),
    [
      "import assert from \"node:assert/strict\";",
      "import test from \"node:test\";",
      "import { validateLogin } from \"../src/auth.js\";",
      "",
      "test(\"accepts valid username/password\", () => {",
      "  assert.equal(validateLogin(\"alice\", \"12345678\"), true);",
      "});",
      "",
      "test(\"rejects whitespace-only username\", () => {",
      "  assert.equal(validateLogin(\"   \", \"12345678\"), false);",
      "});",
      ""
    ].join("\n"),
    "utf8"
  );

  await runWithResult("git", ["init"], root, 20_000);
  await runWithResult("git", ["config", "user.email", "salacia-public-bench@example.com"], root, 10_000);
  await runWithResult("git", ["config", "user.name", "Salacia Public Bench"], root, 10_000);
  await runWithResult("git", ["add", "."], root, 20_000);
  await runWithResult("git", ["commit", "-m", "seed"], root, 20_000);
}

async function runAiderLeaderboardSmoke(cwd, runDir, timeoutMs) {
  const aiderCheck = await checkCommand("aider", cwd);
  const metadata = {
    suite: "aider_leaderboard_smoke",
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    aider: aiderCheck,
    officialComparable: false,
    note: "Smoke proxy task, not official aider leaderboard result"
  };
  await fs.writeFile(path.join(runDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");

  if (!aiderCheck.ok) {
    const result = {
      ok: false,
      status: "blocked",
      suite: "aider_leaderboard_smoke",
      standard: SUITE_DEFINITIONS.aider_leaderboard_smoke.standard,
      reason: aiderCheck.reason,
      officialComparable: false,
      metadataPath: path.join(runDir, "metadata.json"),
      logPath: path.join(runDir, "run.log")
    };
    await fs.writeFile(path.join(runDir, "run.log"), aiderCheck.reason, "utf8");
    await fs.writeFile(path.join(runDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
    return result;
  }

  const repoPath = path.join(runDir, "repo");
  await fs.mkdir(repoPath, { recursive: true });
  await initSeedRepo(repoPath);

  const prompt = "Fix src/auth.js so whitespace-only usernames are rejected while keeping the same API. Update tests if needed and ensure node --test passes.";
  const args = [
    "--yes-always",
    "--no-auto-commits",
    "--no-check-update",
    "--no-show-release-notes",
    "--no-analytics",
    "--message",
    prompt,
    "src/auth.js",
    "tests/auth.test.js"
  ];

  const started = Date.now();
  const runResult = await runWithResult("aider", args, repoPath, timeoutMs);
  const testResult = await runWithResult("node", ["--test"], repoPath, timeoutMs);
  const changed = await runWithResult("git", ["status", "--porcelain"], repoPath, 30_000);
  const changedFiles = changed.ok
    ? changed.output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 3)
      .map((line) => line.slice(3).trim())
    : [];

  const success = runResult.ok && testResult.ok && changedFiles.length > 0;
  const log = [
    `aider exit=${runResult.code}`,
    runResult.output,
    "",
    `node --test exit=${testResult.code}`,
    testResult.output,
    "",
    "changed files:",
    ...changedFiles
  ].join("\n");

  await fs.writeFile(path.join(runDir, "run.log"), log, "utf8");

  const result = {
    ok: success,
    status: success ? "pass" : "fail",
    suite: "aider_leaderboard_smoke",
    standard: SUITE_DEFINITIONS.aider_leaderboard_smoke.standard,
    reason: success
      ? "aider completed smoke proxy task"
      : runResult.ok
        ? testResult.ok
          ? "no code changes detected"
          : "test verification failed"
        : "aider execution failed",
    durationMs: Date.now() - started,
    officialComparable: false,
    metrics: {
      changedFiles: changedFiles.length,
      testPassed: testResult.ok,
      aiderExitCode: runResult.code,
      verifyExitCode: testResult.code
    },
    metadataPath: path.join(runDir, "metadata.json"),
    logPath: path.join(runDir, "run.log")
  };

  await fs.writeFile(path.join(runDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
  return result;
}

async function runSwebenchSmoke(cwd, runDir, suiteDef, instanceId, timeoutMs) {
  const docker = await checkDockerDaemon(cwd);
  const swebench = await checkPythonModule(cwd, "swebench");
  const metadata = {
    suite: suiteDef.id,
    standard: suiteDef.standard,
    dataset: suiteDef.dataset,
    instanceId,
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    pythonVersion: await run("python3", ["--version"], cwd).catch(() => "unknown"),
    docker,
    swebench,
    officialComparable: false,
    note: "gold smoke execution for harness health; not leaderboard submission"
  };
  await fs.writeFile(path.join(runDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");

  if (!docker.ok || !swebench.ok) {
    const reason = !docker.ok ? docker.reason : swebench.reason;
    const result = {
      ok: false,
      status: "blocked",
      suite: suiteDef.id,
      standard: suiteDef.standard,
      reason,
      officialComparable: false,
      metrics: {
        failureCategory: "infra-block"
      },
      metadataPath: path.join(runDir, "metadata.json"),
      logPath: path.join(runDir, "run.log")
    };
    await fs.writeFile(path.join(runDir, "run.log"), reason, "utf8");
    await fs.writeFile(path.join(runDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
    return result;
  }

  const command = [
    "python3",
    "-m",
    "swebench.harness.run_evaluation",
    "-d",
    suiteDef.dataset,
    "-s",
    "test",
    "-i",
    instanceId,
    "-p",
    "gold",
    "-id",
    `salacia-public-${suiteDef.id}-${Date.now()}`,
    "--max_workers",
    "1",
    "-t",
    "600",
    "--clean",
    "false",
    "--cache_level",
    "env",
    "--report_dir",
    runDir
  ];

  try {
    const output = await run(command[0], command.slice(1), cwd, timeoutMs);
    await fs.writeFile(path.join(runDir, "run.log"), output, "utf8");
    const result = {
      ok: true,
      status: "pass",
      suite: suiteDef.id,
      standard: suiteDef.standard,
      reason: "swebench harness smoke passed",
      officialComparable: false,
      metadataPath: path.join(runDir, "metadata.json"),
      logPath: path.join(runDir, "run.log")
    };
    await fs.writeFile(path.join(runDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
    return result;
  } catch (error) {
    const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}\n${error.message ?? ""}`.trim();
    await fs.writeFile(path.join(runDir, "run.log"), output, "utf8");
    const result = {
      ok: false,
      status: "fail",
      suite: suiteDef.id,
      standard: suiteDef.standard,
      reason: error.message,
      officialComparable: false,
      metadataPath: path.join(runDir, "metadata.json"),
      logPath: path.join(runDir, "run.log")
    };
    await fs.writeFile(path.join(runDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
    return result;
  }
}

async function runSwebenchRealSingle(
  cwd,
  runDir,
  suiteDef,
  instanceId,
  timeoutMs,
  backend,
  model,
  modelChainRaw,
  scaffoldEnabled,
  group,
  sampleId,
  instanceIndex,
  localRetryMax
) {
  const docker = await checkDockerDaemon(cwd);
  const swebench = await checkPythonModule(cwd, "swebench");
  const backendBinary = (backend === "claude") ? "claude" : (backend === "aider") ? "aider" : (backend === "gemini") ? "npx" : "codex";
  const backendCmd = await checkCommand(backendBinary, cwd);
  const instance = await loadSwebenchInstance(cwd, suiteDef.dataset, instanceId);
  const modelChain = parseModelChain(modelChainRaw, backend, model);
  const metadata = {
    suite: suiteDef.id,
    standard: suiteDef.standard,
    dataset: suiteDef.dataset,
    instanceId,
    backend,
    group,
    scaffoldEnabled,
    modelChain,
    selectedModel: null,
    modelProbeEvidence: {
      attempted: [],
      failures: []
    },
    sampleId: sampleId || null,
    instanceIndex: Number.isFinite(instanceIndex) ? instanceIndex : null,
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    pythonVersion: await run("python3", ["--version"], cwd).catch(() => "unknown"),
    docker,
    swebench,
    backendCmd,
    instanceLookup: instance.ok ? "ok" : instance.reason,
    officialComparable: false,
    note: "real single-instance model patch evaluation (not official leaderboard-scale run)"
  };
  await fs.writeFile(path.join(runDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");

  if (!docker.ok || !swebench.ok || !backendCmd.ok || !instance.ok) {
    const reason = !docker.ok
      ? docker.reason
      : !swebench.ok
        ? swebench.reason
        : !backendCmd.ok
          ? backendCmd.reason
          : instance.reason;
    const result = {
      ok: false,
      status: "blocked",
      suite: suiteDef.id,
      standard: suiteDef.standard,
      reason,
      officialComparable: false,
      metrics: {
        failureCategory: "infra-block"
      },
      metadataPath: path.join(runDir, "metadata.json"),
      logPath: path.join(runDir, "run.log")
    };
    await fs.writeFile(path.join(runDir, "run.log"), String(reason), "utf8");
    await fs.writeFile(path.join(runDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
    return result;
  }

  const instancePayload = instance.payload;
  await fs.writeFile(path.join(runDir, "instance.json"), JSON.stringify(instancePayload, null, 2), "utf8");
  const repoInit = await initRealRepo(runDir, instancePayload);
  if (!repoInit.ok) {
    const result = {
      ok: false,
      status: "fail",
      suite: suiteDef.id,
      standard: suiteDef.standard,
      group,
      scaffoldEnabled,
      modelChain,
      selectedModel: null,
      modelProbeEvidence: {
        attempted: [],
        failures: []
      },
      sampleId: sampleId || null,
      instanceIndex: Number.isFinite(instanceIndex) ? instanceIndex : null,
      reason: repoInit.reason,
      officialComparable: false,
      metrics: {
        failureCategory: "model-fail"
      },
      metadataPath: path.join(runDir, "metadata.json"),
      logPath: path.join(runDir, "run.log")
    };
    await fs.writeFile(path.join(runDir, "run.log"), String(repoInit.reason), "utf8");
    await fs.writeFile(path.join(runDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
    return result;
  }

  const repoPath = repoInit.repoPath;
  const issueText = [instancePayload.problem_statement, instancePayload.hints_text].filter(Boolean).join("\n\n");
  const localization = await localizeFault(
    repoPath,
    instancePayload.problem_statement,
    instancePayload.hints_text,
    {
      maxFiles: 10,
      maxHitsPerQuery: 12,
      maxSnippetChars: 12_000
    }
  );
  await fs.writeFile(path.join(runDir, "fault-localization.json"), JSON.stringify(localization, null, 2), "utf8");
  const aiderTargetFiles = backend === "aider"
    ? await resolveAiderTargetFiles(repoPath, localization, 10)
    : [];

  const treeMap = await buildTreeSitterRepoMap(localization.rankedFiles || [], {
    maxFiles: 8,
    maxSymbolsPerFile: 10,
    maxPromptFiles: 6,
    maxPromptSymbols: 20
  });
  await fs.writeFile(path.join(runDir, "repo-map.json"), JSON.stringify(treeMap, null, 2), "utf8");
  await fs.writeFile(path.join(runDir, "symbol-graph.json"), JSON.stringify({
    engine: treeMap.engine,
    rankingMethod: treeMap.rankingMethod,
    nodes: treeMap.graph?.nodes || [],
    edges: treeMap.graph?.edges || [],
    topFiles: treeMap.topFiles || [],
    topSymbols: treeMap.topSymbols || []
  }, null, 2), "utf8");
  await fs.writeFile(path.join(runDir, "repo-map-ranked.txt"), treeMap.rankedText || treeMap.text || "", "utf8");

  const repoContext = await buildRepoContext(repoPath, issueText, {
    maxFiles: 8,
    maxHitsPerKeyword: 8,
    maxSnippetFiles: 6,
    maxSnippetChars: 10_000
  });
  // Override with stronger fault-localization artifacts (code-biased ranking).
  repoContext.relevantFiles = (treeMap.topFiles || []).slice(0, 6).map((file) => ({
    path: file.path,
    score: file.rank,
    hitCount: file.hitCount
  }));
  repoContext.repoMap = treeMap.rankedText || treeMap.text || repoContext.repoMap;
  repoContext.localizationEngine = treeMap.engine;
  repoContext.rankingMethod = treeMap.rankingMethod;
  repoContext.topSymbols = (treeMap.topSymbols || []).slice(0, 20);
  repoContext.codeSnippets = localization.snippets || repoContext.codeSnippets;
  await fs.writeFile(path.join(runDir, "repo-context.json"), JSON.stringify(repoContext, null, 2), "utf8");

  const intent = sublimateIntent(instancePayload, localization, repoContext);
  await fs.writeFile(path.join(runDir, "intent-ir.json"), JSON.stringify(intent, null, 2), "utf8");

  const localTestPlan = await buildLocalTestPlan(repoPath, instancePayload, repoContext);
  await fs.writeFile(path.join(runDir, "local-test-plan.json"), JSON.stringify(localTestPlan, null, 2), "utf8");

  const miniContract = createMiniContract(repoPath, instancePayload, intent, localization, localTestPlan);
  await fs.writeFile(path.join(runDir, "mini-contract.json"), JSON.stringify(miniContract, null, 2), "utf8");

  const prompt = buildRealTaskPrompt(
    instancePayload,
    repoPath,
    scaffoldEnabled,
    {
      repoContext,
      localization,
      intent,
      contract: miniContract
    },
    suiteDef.standard
  );
  await fs.writeFile(path.join(runDir, "task_prompt.txt"), prompt, "utf8");

  metadata.repoContext = {
    keywords: repoContext.keywords,
    relevantFiles: (repoContext.relevantFiles || []).map((item) => item.path).slice(0, 12),
    localizationEngine: treeMap.engine,
    rankingMethod: treeMap.rankingMethod,
    topSymbolCount: Array.isArray(treeMap.topSymbols) ? treeMap.topSymbols.length : 0
  };
  metadata.intent = {
    id: intent.id,
    risk: intent.risk,
    unknowns: intent.unknowns,
    affectedAreas: intent.affectedAreas.slice(0, 8)
  };
  metadata.contract = {
    contractId: miniContract.contractId,
    inScope: miniContract.scope.inScope.slice(0, 8),
    protectedPaths: miniContract.guardrails.protectedPaths.slice(0, 8)
  };
  metadata.localTestPlan = localTestPlan;
  if (backend === "aider") {
    metadata.aiderTargetFiles = aiderTargetFiles;
  }

  const snapshotMetrics = {
    created: false,
    verified: false,
    attempts: 0,
    files: []
  };
  const rollbackMetrics = {
    triggered: 0,
    success: 0,
    failed: 0
  };

  const preSnapshotPath = path.join(runDir, "snapshot.pre.json");
  const preSnapshot = await createBenchmarkSnapshot(repoPath, preSnapshotPath, {
    label: "pre"
  });
  if (!preSnapshot.ok) {
    const result = {
      ok: false,
      status: "fail",
      suite: suiteDef.id,
      standard: suiteDef.standard,
      group,
      scaffoldEnabled,
      modelChain,
      selectedModel: null,
      modelProbeEvidence: {
        attempted: [],
        failures: []
      },
      sampleId: sampleId || null,
      instanceIndex: Number.isFinite(instanceIndex) ? instanceIndex : null,
      reason: `failed to create pre snapshot: ${preSnapshot.reason || "snapshot capture failed"}`,
      officialComparable: false,
      metrics: {
        failureCategory: "model-fail",
        snapshot: snapshotMetrics,
        rollback: rollbackMetrics
      },
      metadataPath: path.join(runDir, "metadata.json"),
      logPath: path.join(runDir, "run.log")
    };
    await fs.writeFile(path.join(runDir, "run.log"), result.reason, "utf8");
    await fs.writeFile(path.join(runDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
    return result;
  }

  snapshotMetrics.created = true;
  snapshotMetrics.verified = Boolean(preSnapshot.snapshot?.snapshotChecksum && preSnapshot.snapshot?.stateChecksum);
  snapshotMetrics.attempts = 1;
  snapshotMetrics.files.push(preSnapshotPath);
  let activeSnapshotPath = preSnapshotPath;
  let activeSnapshotId = preSnapshot.snapshot?.id ?? null;

  let patchRun = await runRealPatchBackendWithChain(
    backend,
    modelChain,
    runDir,
    repoPath,
    prompt,
    timeoutMs,
    {
      aiderTargetFiles
    }
  );
  metadata.selectedModel = patchRun.selectedModel;
  metadata.modelProbeEvidence = patchRun.modelProbeEvidence;
  metadata.snapshot = snapshotMetrics;
  metadata.rollback = rollbackMetrics;
  await fs.writeFile(path.join(runDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");

  if (!patchRun.ok) {
    const failureCategory = classifyBackendFailureCategory(patchRun.reason);
    const result = {
      ok: false,
      status: failureCategory === "infra-block" ? "blocked" : "fail",
      suite: suiteDef.id,
      standard: suiteDef.standard,
      group,
      scaffoldEnabled,
      modelChain,
      selectedModel: patchRun.selectedModel,
      modelProbeEvidence: patchRun.modelProbeEvidence,
      sampleId: sampleId || null,
      instanceIndex: Number.isFinite(instanceIndex) ? instanceIndex : null,
      reason: patchRun.reason,
      officialComparable: false,
      metrics: {
        failureCategory,
        snapshot: snapshotMetrics,
        rollback: rollbackMetrics
      },
      metadataPath: path.join(runDir, "metadata.json"),
      logPath: path.join(runDir, "run.log")
    };
    await fs.writeFile(path.join(runDir, "run.log"), String(patchRun.reason), "utf8");
    await fs.writeFile(path.join(runDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
    return result;
  }

  const maxRetryCount = Number.isFinite(localRetryMax) ? Math.max(0, localRetryMax) : 0;
  const localValidationTimeout = Math.min(timeoutMs, 10 * 60 * 1000);
  let localValidation = {
    skipped: true,
    ok: true,
    reason: "local validation skipped",
    command: null,
    output: ""
  };
  let contractValidation = {
    ok: true,
    changedFiles: [],
    violations: []
  };
  const guardianAttempts = [];
  let patch = "";
  let retryCount = 0;

  while (true) {
    const patchResult = await runWithResult("git", ["diff"], repoPath, 30_000);
    patch = patchResult.ok ? patchResult.output : "";
    const patchFileName = retryCount === 0 ? "model.patch" : `model.retry-${retryCount}.patch`;
    await fs.writeFile(path.join(runDir, patchFileName), patch, "utf8");

    if (!patch.trim()) {
      const result = {
        ok: false,
        status: "fail",
        suite: suiteDef.id,
        standard: suiteDef.standard,
        group,
        scaffoldEnabled,
        modelChain,
        selectedModel: patchRun.selectedModel,
        modelProbeEvidence: patchRun.modelProbeEvidence,
        sampleId: sampleId || null,
        instanceIndex: Number.isFinite(instanceIndex) ? instanceIndex : null,
        reason: "model generated empty patch",
        officialComparable: false,
        metrics: {
          failureCategory: "model-fail",
          snapshot: snapshotMetrics,
          rollback: rollbackMetrics
        },
        metadataPath: path.join(runDir, "metadata.json"),
        logPath: path.join(runDir, "run.log")
      };
      await fs.writeFile(path.join(runDir, "run.log"), "model generated empty patch", "utf8");
      await fs.writeFile(path.join(runDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
      return result;
    }

    const changedFiles = await listChangedFiles(repoPath);
    contractValidation = validatePatchAgainstContract(repoPath, miniContract, changedFiles);
    contractValidation.scopeCoverage = computeScopeCoverage(contractValidation);
    const contractFileName = retryCount === 0 ? "contract-check.json" : `contract-check.retry-${retryCount}.json`;
    await fs.writeFile(path.join(runDir, contractFileName), JSON.stringify(contractValidation, null, 2), "utf8");

    localValidation = await runLocalTestPlan(repoPath, localTestPlan, localValidationTimeout);
    const validationFileName = retryCount === 0 ? "local-validation.json" : `local-validation.retry-${retryCount}.json`;
    const validationLogName = retryCount === 0 ? "local-validation.log" : `local-validation.retry-${retryCount}.log`;
    await fs.writeFile(path.join(runDir, validationFileName), JSON.stringify(localValidation, null, 2), "utf8");
    await fs.writeFile(path.join(runDir, validationLogName), String(localValidation.output || localValidation.reason || ""), "utf8");

    const contractErrorText = contractValidation.ok
      ? ""
      : [
        "Contract violations:",
        ...contractValidation.violations.map((violation) => `- ${violation.message}`)
      ].join("\n");

    const combinedValidation = {
      skipped: false,
      ok: localValidation.ok && contractValidation.ok,
      reason: contractValidation.ok ? localValidation.reason : "contract validation failed",
      command: localValidation.command || "contract-check",
      output: [localValidation.output, contractErrorText].filter(Boolean).join("\n\n")
    };

    const guardianRecord = {
      attempt: retryCount,
      createdAt: new Date().toISOString(),
      snapshotId: activeSnapshotId,
      snapshotPath: activeSnapshotPath,
      graphVersion: treeMap.rankingMethod || null,
      changedFiles: contractValidation.changedFiles,
      contractValidation,
      localValidation,
      combinedValidation,
      rollbackVerified: false,
      rolledBack: false,
      rollback: null
    };
    const guardianPath = await writeGuardianAttemptRecord(runDir, guardianRecord);
    guardianAttempts.push(guardianPath);

    const shouldRetry = !combinedValidation.ok && retryCount < maxRetryCount;
    if (shouldHardBlockContract(contractValidation, retryCount, maxRetryCount)) {
      const result = {
        ok: false,
        status: "fail",
        suite: suiteDef.id,
        standard: suiteDef.standard,
        group,
        scaffoldEnabled,
        modelChain,
        selectedModel: patchRun.selectedModel,
        modelProbeEvidence: patchRun.modelProbeEvidence,
        sampleId: sampleId || null,
        instanceIndex: Number.isFinite(instanceIndex) ? instanceIndex : null,
        reason: "contract-block",
        officialComparable: false,
        metrics: {
          backend,
          model: patchRun.modelLabel,
          provider: patchRun.provider,
          localValidation: {
            skipped: Boolean(localValidation?.skipped),
            ok: Boolean(localValidation?.ok),
            command: localValidation?.command || null,
            retriesAttempted: retryCount,
            maxRetryCount
          },
          contractValidation: {
            ok: Boolean(contractValidation?.ok),
            changedFiles: contractValidation?.changedFiles || [],
            violations: contractValidation?.violations || [],
            scopeCoverage: Number(contractValidation?.scopeCoverage ?? 0)
          },
          snapshot: snapshotMetrics,
          rollback: rollbackMetrics,
          symbolGraph: {
            engine: treeMap.engine,
            nodes: Number(treeMap.nodes || 0),
            edges: Number(treeMap.edges || 0),
            rankingMethod: treeMap.rankingMethod || "v1",
            topFiles: (treeMap.topFiles || []).map((file) => file.path)
          },
          guardian: {
            attempts: guardianAttempts.length,
            records: guardianAttempts
          },
          failureCategory: "contract-block"
        },
        metadataPath: path.join(runDir, "metadata.json"),
        logPath: path.join(runDir, "run.log")
      };
      await fs.writeFile(
        path.join(runDir, "run.log"),
        String(combinedValidation.output || combinedValidation.reason || "contract-block"),
        "utf8"
      );
      await fs.writeFile(path.join(runDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
      return result;
    }
    if (!shouldRetry) {
      break;
    }

    rollbackMetrics.triggered += 1;
    const rollbackRestore = await restoreBenchmarkSnapshot(repoPath, activeSnapshotPath);
    const rollbackVerify = await runMinimalVerification(repoPath);
    const rollbackRecord = {
      forRetryAttempt: retryCount + 1,
      snapshotId: activeSnapshotId,
      snapshotPath: activeSnapshotPath,
      attemptedAt: new Date().toISOString(),
      restore: rollbackRestore,
      verify: rollbackVerify,
      verified: rollbackRestore.ok && rollbackVerify.ok
    };
    await fs.writeFile(
      path.join(runDir, `rollback.retry-${retryCount + 1}.json`),
      JSON.stringify(rollbackRecord, null, 2),
      "utf8"
    );
    guardianRecord.rolledBack = rollbackRecord.verified;
    guardianRecord.rollbackVerified = rollbackRecord.verified;
    guardianRecord.rollback = rollbackRecord;
    await fs.writeFile(guardianPath, JSON.stringify(guardianRecord, null, 2), "utf8");

    if (!rollbackRecord.verified) {
      rollbackMetrics.failed += 1;
      const result = {
        ok: false,
        status: "fail",
        suite: suiteDef.id,
        standard: suiteDef.standard,
        group,
        scaffoldEnabled,
        modelChain,
        selectedModel: patchRun.selectedModel,
        modelProbeEvidence: patchRun.modelProbeEvidence,
        sampleId: sampleId || null,
        instanceIndex: Number.isFinite(instanceIndex) ? instanceIndex : null,
        reason: "rollback-integrity-fail",
        officialComparable: false,
        metrics: {
          failureCategory: "rollback-fail",
          snapshot: snapshotMetrics,
          rollback: rollbackMetrics
        },
        metadataPath: path.join(runDir, "metadata.json"),
        logPath: path.join(runDir, "run.log")
      };
      await fs.writeFile(path.join(runDir, "run.log"), JSON.stringify(rollbackRecord, null, 2), "utf8");
      await fs.writeFile(path.join(runDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
      return result;
    }
    rollbackMetrics.success += 1;

    retryCount += 1;
    const retrySnapshotPath = path.join(runDir, `snapshot.retry-${retryCount}.json`);
    const retrySnapshot = await createBenchmarkSnapshot(repoPath, retrySnapshotPath, {
      label: `retry-${retryCount}`
    });
    if (!retrySnapshot.ok) {
      const result = {
        ok: false,
        status: "fail",
        suite: suiteDef.id,
        standard: suiteDef.standard,
        group,
        scaffoldEnabled,
        modelChain,
        selectedModel: patchRun.selectedModel,
        modelProbeEvidence: patchRun.modelProbeEvidence,
        sampleId: sampleId || null,
        instanceIndex: Number.isFinite(instanceIndex) ? instanceIndex : null,
        reason: `failed to create retry snapshot: ${retrySnapshot.reason || "snapshot capture failed"}`,
        officialComparable: false,
        metrics: {
          failureCategory: "model-fail",
          snapshot: snapshotMetrics,
          rollback: rollbackMetrics
        },
        metadataPath: path.join(runDir, "metadata.json"),
        logPath: path.join(runDir, "run.log")
      };
      await fs.writeFile(path.join(runDir, "run.log"), result.reason, "utf8");
      await fs.writeFile(path.join(runDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
      return result;
    }
    snapshotMetrics.attempts += 1;
    snapshotMetrics.files.push(retrySnapshotPath);
    snapshotMetrics.verified = snapshotMetrics.verified
      && Boolean(retrySnapshot.snapshot?.snapshotChecksum && retrySnapshot.snapshot?.stateChecksum);
    activeSnapshotPath = retrySnapshotPath;
    activeSnapshotId = retrySnapshot.snapshot?.id ?? null;

    const retryPrompt = buildRetryPrompt(prompt, combinedValidation, retryCount);
    await fs.writeFile(path.join(runDir, `task_prompt.retry-${retryCount}.txt`), retryPrompt, "utf8");
    patchRun = await runRealPatchBackendWithChain(
      backend,
      modelChain,
      runDir,
      repoPath,
      retryPrompt,
      timeoutMs,
      {
        aiderTargetFiles
      }
    );
    metadata.selectedModel = patchRun.selectedModel;
    metadata.modelProbeEvidence = patchRun.modelProbeEvidence;
    metadata.localValidation = {
      retriesAttempted: retryCount,
      maxRetryCount
    };
    metadata.guardian = {
      attempts: guardianAttempts.length
    };
    metadata.snapshot = snapshotMetrics;
    metadata.rollback = rollbackMetrics;
    await fs.writeFile(path.join(runDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");

    if (!patchRun.ok) {
      const failureCategory = classifyBackendFailureCategory(patchRun.reason);
      const result = {
        ok: false,
        status: failureCategory === "infra-block" ? "blocked" : "fail",
        suite: suiteDef.id,
        standard: suiteDef.standard,
        group,
        scaffoldEnabled,
        modelChain,
        selectedModel: patchRun.selectedModel,
        modelProbeEvidence: patchRun.modelProbeEvidence,
        sampleId: sampleId || null,
        instanceIndex: Number.isFinite(instanceIndex) ? instanceIndex : null,
        reason: patchRun.reason,
        officialComparable: false,
        metrics: {
          failureCategory,
          snapshot: snapshotMetrics,
          rollback: rollbackMetrics
        },
        metadataPath: path.join(runDir, "metadata.json"),
        logPath: path.join(runDir, "run.log")
      };
      await fs.writeFile(path.join(runDir, "run.log"), String(patchRun.reason), "utf8");
      await fs.writeFile(path.join(runDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
      return result;
    }
  }

  const predictions = [
    {
      instance_id: instancePayload.instance_id,
      model_name_or_path: patchRun.modelLabel,
      model_patch: patch
    }
  ];
  const predictionsPath = path.join(runDir, "predictions.json");
  await fs.writeFile(predictionsPath, JSON.stringify(predictions, null, 2), "utf8");

  const evaluationRunId = `salacia-real-${instancePayload.instance_id}-${Date.now()}`;
  const evalArgs = [
    "-m",
    "swebench.harness.run_evaluation",
    "-d",
    suiteDef.dataset,
    "-s",
    "test",
    "-i",
    instancePayload.instance_id,
    "-p",
    predictionsPath,
    "-id",
    evaluationRunId,
    "--max_workers",
    "1",
    "-t",
    "3600",
    "--clean",
    "false",
    "--cache_level",
    "env",
    "--report_dir",
    runDir
  ];
  const evalRun = await runWithResult("python3", evalArgs, runDir, timeoutMs);
  await fs.writeFile(path.join(runDir, "eval.log"), evalRun.output, "utf8");
  await fs.writeFile(path.join(runDir, "run.log"), evalRun.output, "utf8");
  if (!evalRun.ok) {
    const result = {
      ok: false,
      status: "fail",
      suite: suiteDef.id,
      standard: suiteDef.standard,
      group,
      scaffoldEnabled,
      modelChain,
      selectedModel: patchRun.selectedModel,
      modelProbeEvidence: patchRun.modelProbeEvidence,
      sampleId: sampleId || null,
      instanceIndex: Number.isFinite(instanceIndex) ? instanceIndex : null,
      reason: `swebench evaluation failed: ${evalRun.output.slice(0, 500)}`,
      officialComparable: false,
      metrics: {
        failureCategory: "eval-fail",
        snapshot: snapshotMetrics,
        rollback: rollbackMetrics
      },
      metadataPath: path.join(runDir, "metadata.json"),
      logPath: path.join(runDir, "run.log")
    };
    await fs.writeFile(path.join(runDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
    return result;
  }

  const reportFiles = (await fs.readdir(runDir))
    .filter((name) => name.endsWith(".json") && name.includes(evaluationRunId));
  const summaryPath = reportFiles[0] ? path.join(runDir, reportFiles[0]) : null;
  const summary = summaryPath
    ? JSON.parse(await fs.readFile(summaryPath, "utf8"))
    : null;
  const resolved = Number(summary?.resolved_instances ?? 0);
  const unresolved = Number(summary?.unresolved_instances ?? 0);
  const errors = Number(summary?.error_instances ?? 0);

  const result = {
    ok: resolved > 0 && unresolved === 0 && errors === 0,
    status: resolved > 0 && unresolved === 0 && errors === 0 ? "pass" : "fail",
    suite: suiteDef.id,
    standard: suiteDef.standard,
    group,
    scaffoldEnabled,
    modelChain,
    selectedModel: patchRun.selectedModel,
    modelProbeEvidence: patchRun.modelProbeEvidence,
    sampleId: sampleId || null,
    instanceIndex: Number.isFinite(instanceIndex) ? instanceIndex : null,
    reason:
      summaryPath
        ? `real single-instance evaluation finished (resolved=${resolved}, unresolved=${unresolved}, errors=${errors})`
        : "evaluation finished but summary report not found",
    officialComparable: false,
    metrics: {
      backend,
      model: patchRun.modelLabel,
      provider: patchRun.provider,
      resolved,
      unresolved,
      errors,
      evaluationRunId,
      localValidation: {
        skipped: Boolean(localValidation?.skipped),
        ok: Boolean(localValidation?.ok),
        command: localValidation?.command || null,
        retriesAttempted: retryCount,
        maxRetryCount
      },
      contractValidation: {
        ok: Boolean(contractValidation?.ok),
        changedFiles: contractValidation?.changedFiles || [],
        violations: contractValidation?.violations || [],
        scopeCoverage: Number(contractValidation?.scopeCoverage ?? 0)
      },
      snapshot: snapshotMetrics,
      rollback: rollbackMetrics,
      symbolGraph: {
        engine: treeMap.engine,
        nodes: Number(treeMap.nodes || 0),
        edges: Number(treeMap.edges || 0),
        rankingMethod: treeMap.rankingMethod || "v1",
        topFiles: (treeMap.topFiles || []).map((file) => file.path)
      },
      guardian: {
        attempts: guardianAttempts.length,
        records: guardianAttempts
      },
      failureCategory: resolved > 0 && unresolved === 0 && errors === 0 ? null : "eval-fail"
    },
    metadataPath: path.join(runDir, "metadata.json"),
    logPath: path.join(runDir, "run.log"),
    summaryPath
  };
  await fs.writeFile(path.join(runDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
  return result;
}

async function runProbeSuite(cwd, runDir, suiteDef, moduleName) {
  const check = await checkPythonModule(cwd, moduleName);
  const metadata = {
    suite: suiteDef.id,
    standard: suiteDef.standard,
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    pythonVersion: await run("python3", ["--version"], cwd).catch(() => "unknown"),
    moduleCheck: check,
    officialComparable: false,
    note: "probe-only: availability check and auditable blocked/pass status"
  };
  await fs.writeFile(path.join(runDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");

  const result = check.ok
    ? {
      ok: true,
      status: "pass",
      suite: suiteDef.id,
      standard: suiteDef.standard,
      reason: `${moduleName} available for future full evaluation wiring`,
      officialComparable: false,
      metadataPath: path.join(runDir, "metadata.json"),
      logPath: path.join(runDir, "run.log")
    }
    : {
      ok: false,
      status: "blocked",
      suite: suiteDef.id,
      standard: suiteDef.standard,
      reason: `${moduleName} unavailable; connector not executable on this host`,
      officialComparable: false,
      metadataPath: path.join(runDir, "metadata.json"),
      logPath: path.join(runDir, "run.log")
    };

  await fs.writeFile(path.join(runDir, "run.log"), result.reason, "utf8");
  await fs.writeFile(path.join(runDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
  return result;
}

async function runDatasetAccessSmoke(cwd, runDir, suiteDef, datasetId) {
  const check = await runWithResult(
    "python3",
    [
      "-c",
      [
        "from datasets import load_dataset",
        `ds = load_dataset('${datasetId}', split='test[:1]')`,
        "print(ds[0]['instance_id'] if len(ds) > 0 and 'instance_id' in ds.column_names else 'ok')"
      ].join("; ")
    ],
    cwd,
    240_000
  );

  const metadata = {
    suite: suiteDef.id,
    standard: suiteDef.standard,
    dataset: datasetId,
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    officialComparable: false,
    note: "dataset-access smoke for rebench-style suites; full harness execution requires dedicated evaluator"
  };
  await fs.writeFile(path.join(runDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");
  await fs.writeFile(path.join(runDir, "run.log"), check.output, "utf8");

  const result = check.ok
    ? {
      ok: true,
      status: "pass",
      suite: suiteDef.id,
      standard: suiteDef.standard,
      reason: `dataset ${datasetId} accessible`,
      officialComparable: false,
      metadataPath: path.join(runDir, "metadata.json"),
      logPath: path.join(runDir, "run.log")
    }
    : {
      ok: false,
      status: "blocked",
      suite: suiteDef.id,
      standard: suiteDef.standard,
      reason: `dataset ${datasetId} unavailable: ${check.output.slice(0, 300)}`,
      officialComparable: false,
      metadataPath: path.join(runDir, "metadata.json"),
      logPath: path.join(runDir, "run.log")
    };

  await fs.writeFile(path.join(runDir, "result.json"), JSON.stringify(result, null, 2), "utf8");
  return result;
}

async function runSuite(cwd, suiteId, runId, timeoutMs, options) {
  const suiteDef = SUITE_DEFINITIONS[suiteId];
  if (!suiteDef) {
    return {
      ok: false,
      status: "blocked",
      suite: suiteId,
      reason: `Unsupported suite: ${suiteId}`
    };
  }

  const isRealSingleSuite = ["swebench_verified_real_single", "swebench_pro_real_single"].includes(suiteId);
  const isProSuite = ["swebench_pro_smoke", "swebench_pro_real_single"].includes(suiteId);
  const runDir =
    isRealSingleSuite
      ? path.join(cwd, ".salacia", "journal", "bench", "public", suiteId, options.group, runId)
      : path.join(cwd, ".salacia", "journal", "bench", "public", suiteId, runId);
  await fs.mkdir(runDir, { recursive: true });

  if (["swebench_lite_smoke", "swebench_verified_smoke", "swebench_pro_smoke"].includes(suiteId)) {
    const selectedInstance = String(options.instanceArg || suiteDef.defaultInstance || "").trim();
    if (isProSuite && selectedInstance.length === 0) {
      return {
        ok: false,
        status: "blocked",
        suite: suiteDef.id,
        standard: suiteDef.standard,
        reason: "SWE-bench Pro requires --instance or SALACIA_SWEBENCH_PRO_DEFAULT_INSTANCE to be set.",
        officialComparable: false
      };
    }
    return runSwebenchSmoke(cwd, runDir, suiteDef, selectedInstance, timeoutMs);
  }

  if (isRealSingleSuite) {
    const selectedInstance = String(options.instanceArg || suiteDef.defaultInstance || "").trim();
    if (isProSuite && selectedInstance.length === 0) {
      return {
        ok: false,
        status: "blocked",
        suite: suiteDef.id,
        standard: suiteDef.standard,
        reason: "SWE-bench Pro requires --instance or SALACIA_SWEBENCH_PRO_DEFAULT_INSTANCE to be set.",
        officialComparable: false
      };
    }
    return runSwebenchRealSingle(
      cwd,
      runDir,
      suiteDef,
      selectedInstance,
      timeoutMs,
      options.backend,
      options.model,
      options.modelChain,
      !options.noScaffold,
      options.group,
      options.sampleId,
      options.instanceIndex,
      options.localRetryMax
    );
  }

  if (suiteId === "aider_leaderboard_smoke") {
    return runAiderLeaderboardSmoke(cwd, runDir, timeoutMs);
  }

  if (suiteId === "livecodebench_probe") {
    return runProbeSuite(cwd, runDir, suiteDef, "lcb_runner");
  }

  if (suiteId === "bigcodebench_probe") {
    return runProbeSuite(cwd, runDir, suiteDef, "bigcodebench");
  }

  if (suiteId === "humaneval_plus_probe") {
    return runProbeSuite(cwd, runDir, suiteDef, "evalplus");
  }

  if (suiteId === "swe_rebench_probe") {
    return runDatasetAccessSmoke(cwd, runDir, suiteDef, suiteDef.dataset);
  }

  return {
    ok: false,
    status: "blocked",
    suite: suiteId,
    reason: `No runner bound for ${suiteId}`
  };
}

async function main() {
  const cwd = process.cwd();
  const suiteArg = parseArg("--suite", "swebench_lite_smoke");
  const instanceArg = parseArg("--instance", undefined);
  const backendArg = (parseArg("--backend", "codex") || "codex").trim().toLowerCase();
  const modelArg = parseArg("--model", undefined);
  const modelChainArg = parseArg("--model-chain", undefined);
  const localRetryMaxRaw = parseArg("--local-retry-max", process.env.SALACIA_LOCAL_RETRY_MAX ?? "0");
  const timeoutMsRaw = parseArg("--timeout-ms", "3600000");
  const noScaffold = hasFlag("--no-scaffold");
  const group = normalizeGroup(parseArg("--group", "scaffold"), noScaffold);
  const sampleIdArg = parseArg("--sample-id", undefined);
  const instanceIndexRaw = parseArg("--instance-index", undefined);
  const instanceIndex = typeof instanceIndexRaw === "string" ? Number.parseInt(instanceIndexRaw, 10) : undefined;
  const timeoutMs = Number.parseInt(timeoutMsRaw, 10);
  const localRetryMax = Number.parseInt(localRetryMaxRaw, 10);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 10_000) {
    throw new Error("Invalid --timeout-ms, expected integer >= 10000.");
  }
  if (!Number.isFinite(localRetryMax) || localRetryMax < 0 || localRetryMax > 3) {
    throw new Error("Invalid --local-retry-max, expected integer in [0,3].");
  }
  if (typeof instanceIndex === "number" && (!Number.isFinite(instanceIndex) || instanceIndex < 1)) {
    throw new Error("Invalid --instance-index, expected integer >= 1.");
  }

  if (!["codex", "claude", "aider", "gemini"].includes(backendArg)) {
    throw new Error("Invalid --backend, expected codex|claude|aider|gemini.");
  }

  const requestedSuites = suiteArg === "all"
    ? COMMUNITY_SUITES
    : suiteArg
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

  const runId = parseArg("--run-id", `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const results = [];

  for (const suiteId of requestedSuites) {
    const result = await runSuite(cwd, suiteId, runId, timeoutMs, {
      instanceArg,
      backend: backendArg,
      model: modelArg,
      modelChain: modelChainArg,
      noScaffold,
      group,
      sampleId: sampleIdArg,
      instanceIndex,
      localRetryMax
    });
    results.push(result);
  }

  const payload = {
    ok: results.every((item) => item.ok),
    runId,
    backend: backendArg,
    group,
    scaffoldEnabled: !noScaffold,
    localRetryMax,
    modelChain: parseModelChain(modelChainArg, backendArg, modelArg),
    selectedModel:
      results.find((item) => typeof item.selectedModel === "string" && item.selectedModel.length > 0)?.selectedModel ??
      null,
    modelProbeEvidence:
      results.find((item) => item.modelProbeEvidence && Array.isArray(item.modelProbeEvidence.attempted))
        ?.modelProbeEvidence ?? null,
    sampleId: sampleIdArg || null,
    instanceIndex: Number.isFinite(instanceIndex) ? instanceIndex : null,
    requestedSuites,
    knownSuites: COMMUNITY_SUITES,
    results
  };

  console.log(JSON.stringify(payload, null, 2));
  if (hasFlag("--strict") && !payload.ok) {
    process.exit(1);
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
