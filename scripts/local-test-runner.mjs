#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function unique(values) {
  return [...new Set(values)];
}

function normalizeRelative(repoPath, absolutePath) {
  const rel = path.relative(repoPath, absolutePath);
  return rel.startsWith("..") ? null : rel;
}

function looksLikePythonTest(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  return (
    normalized.includes("tests/") ||
    normalized.endsWith("_test.py") ||
    normalized.endsWith("test.py") ||
    normalized.includes("testing/")
  );
}

function looksLikeJsTest(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  return (
    normalized.includes("test/") ||
    normalized.includes("tests/") ||
    normalized.endsWith(".test.js") ||
    normalized.endsWith(".spec.js") ||
    normalized.endsWith(".test.ts") ||
    normalized.endsWith(".spec.ts")
  );
}

export async function buildLocalTestPlan(repoPath, instance, repoContext) {
  const markers = {
    pyproject: await fileExists(path.join(repoPath, "pyproject.toml")),
    pytestIni: await fileExists(path.join(repoPath, "pytest.ini")),
    setupCfg: await fileExists(path.join(repoPath, "setup.cfg")),
    packageJson: await fileExists(path.join(repoPath, "package.json"))
  };

  const relevant = Array.isArray(repoContext?.relevantFiles) ? repoContext.relevantFiles : [];
  const relativeRelevant = unique(
    relevant
      .map((entry) => normalizeRelative(repoPath, String(entry.path || "")))
      .filter(Boolean)
  );

  const pythonCandidates = relativeRelevant.filter(looksLikePythonTest).slice(0, 4);
  const jsCandidates = relativeRelevant.filter(looksLikeJsTest).slice(0, 4);

  if (markers.pyproject || markers.pytestIni || markers.setupCfg) {
    const args = ["-m", "pytest", "-q", ...pythonCandidates];
    return {
      skipped: false,
      reason: pythonCandidates.length > 0
        ? "selected related python tests"
        : "selected fallback python smoke test command",
      command: "python3",
      args
    };
  }

  if (markers.packageJson) {
    if (jsCandidates.length > 0) {
      return {
        skipped: false,
        reason: "selected related javascript tests",
        command: "node",
        args: ["--test", ...jsCandidates]
      };
    }

    return {
      skipped: false,
      reason: "selected fallback npm test command",
      command: "npm",
      args: ["test", "--", "--runInBand"]
    };
  }

  return {
    skipped: true,
    reason: "no local test command detected for repository type"
  };
}

export async function runLocalTestPlan(repoPath, plan, timeoutMs) {
  if (!plan || plan.skipped) {
    return {
      skipped: true,
      ok: true,
      reason: String(plan?.reason || "local test skipped"),
      command: null,
      output: ""
    };
  }

  const env = { ...process.env };
  if (plan.command === "python3" && Array.isArray(plan.args) && plan.args.includes("-m") && plan.args.includes("pytest")) {
    // Keep local validation deterministic across host Python plugin environments.
    env.PYTEST_DISABLE_PLUGIN_AUTOLOAD = env.PYTEST_DISABLE_PLUGIN_AUTOLOAD || "1";
  }

  try {
    const { stdout, stderr } = await execFileAsync(plan.command, plan.args || [], {
      cwd: repoPath,
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      env
    });
    return {
      skipped: false,
      ok: true,
      exitCode: 0,
      reason: plan.reason,
      command: `${plan.command} ${(plan.args || []).join(" ")}`.trim(),
      output: `${stdout}\n${stderr}`.trim()
    };
  } catch (error) {
    return {
      skipped: false,
      ok: false,
      exitCode: typeof error?.code === "number" ? error.code : 1,
      reason: plan.reason,
      command: `${plan.command} ${(plan.args || []).join(" ")}`.trim(),
      output: `${error?.stdout ?? ""}\n${error?.stderr ?? ""}\n${error?.message ?? ""}`.trim()
    };
  }
}

function parsePorcelainStatus(raw) {
  return String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length >= 3)
    .map((line) => {
      const match = line.match(/^(.{2})\s+(.*)$/);
      if (!match) return null;
      const code = match[1].replace(/\s/g, "");
      const file = match[2].trim();
      return { code, file };
    })
    .filter(Boolean);
}

export async function runMinimalVerification(repoPath, timeoutMs = 30_000) {
  try {
    const { stdout, stderr } = await execFileAsync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: repoPath,
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024
    });

    const output = `${stdout}\n${stderr}`.trim();
    const rows = parsePorcelainStatus(output);
    const conflicts = rows.filter((row) => row.code.includes("U") || row.code === "AA" || row.code === "DD");

    return {
      ok: conflicts.length === 0,
      command: "git status --porcelain=v1 --untracked-files=all",
      reason: conflicts.length === 0 ? "minimal verification passed" : "merge conflicts detected",
      output,
      conflicts
    };
  } catch (error) {
    return {
      ok: false,
      command: "git status --porcelain=v1 --untracked-files=all",
      reason: "minimal verification command failed",
      output: `${error?.stdout ?? ""}\n${error?.stderr ?? ""}\n${error?.message ?? ""}`.trim(),
      conflicts: []
    };
  }
}
