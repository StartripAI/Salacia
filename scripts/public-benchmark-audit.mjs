#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const SUITE_DEFINITIONS = {
  swebench_lite_smoke: {
    id: "swebench_lite_smoke",
    standard: "SWE-bench Lite",
    officialComparable: false
  },
  swebench_verified_smoke: {
    id: "swebench_verified_smoke",
    standard: "SWE-bench Verified",
    officialComparable: false
  },
  swebench_verified_real_single: {
    id: "swebench_verified_real_single",
    standard: "SWE-bench Verified (real single-instance)",
    officialComparable: false
  },
  swebench_pro_smoke: {
    id: "swebench_pro_smoke",
    standard: "SWE-bench Pro",
    officialComparable: false
  },
  swebench_pro_real_single: {
    id: "swebench_pro_real_single",
    standard: "SWE-bench Pro (real single-instance)",
    officialComparable: false
  },
  aider_leaderboard_smoke: {
    id: "aider_leaderboard_smoke",
    standard: "Aider LLM Leaderboard (smoke proxy)",
    officialComparable: false
  },
  livecodebench_probe: {
    id: "livecodebench_probe",
    standard: "LiveCodeBench",
    officialComparable: false
  },
  bigcodebench_probe: {
    id: "bigcodebench_probe",
    standard: "BigCodeBench",
    officialComparable: false
  },
  swe_rebench_probe: {
    id: "swe_rebench_probe",
    standard: "SWE-rebench",
    officialComparable: false
  },
  humaneval_plus_probe: {
    id: "humaneval_plus_probe",
    standard: "HumanEval+ / MBPP",
    officialComparable: false
  }
};

const RELEASE_REQUIRED_SUITES = ["swebench_lite_smoke"];
const COMMUNITY_REQUIRED_SUITES = ["swebench_verified_smoke", "swebench_pro_smoke", "bigcodebench_probe"];
const FULL_REQUIRED_SUITES = Object.keys(SUITE_DEFINITIONS);

function parseArg(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

async function loadLatestResult(cwd, suite) {
  const root = path.join(cwd, ".salacia", "journal", "bench", "public", suite);
  const dirs = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  if (dirs.length === 0) {
    return {
      suite,
      standard: SUITE_DEFINITIONS[suite]?.standard ?? suite,
      officialComparable: SUITE_DEFINITIONS[suite]?.officialComparable ?? false,
      ok: false,
      status: "missing",
      reason: "no runs found"
    };
  }

  const ranked = [];
  for (const dirent of dirs) {
    if (!dirent.isDirectory()) {
      continue;
    }

    const directResultPath = path.join(root, dirent.name, "result.json");
    const directStat = await fs.stat(directResultPath).catch(() => null);
    if (directStat) {
      ranked.push({
        id: dirent.name,
        resultPath: directResultPath,
        mtimeMs: directStat.mtimeMs,
        group: null
      });
      continue;
    }

    const nested = await fs.readdir(path.join(root, dirent.name), { withFileTypes: true }).catch(() => []);
    for (const nestedDirent of nested) {
      if (!nestedDirent.isDirectory()) continue;
      const nestedResultPath = path.join(root, dirent.name, nestedDirent.name, "result.json");
      const nestedStat = await fs.stat(nestedResultPath).catch(() => null);
      if (!nestedStat) continue;
      ranked.push({
        id: `${dirent.name}/${nestedDirent.name}`,
        resultPath: nestedResultPath,
        mtimeMs: nestedStat.mtimeMs,
        group: dirent.name
      });
    }
  }

  ranked.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const latest = ranked[0];
  if (!latest) {
    return {
      suite,
      standard: SUITE_DEFINITIONS[suite]?.standard ?? suite,
      officialComparable: SUITE_DEFINITIONS[suite]?.officialComparable ?? false,
      ok: false,
      status: "missing",
      reason: "no result.json found"
    };
  }

  const payload = JSON.parse(await fs.readFile(latest.resultPath, "utf8"));
  return {
    suite,
    standard: SUITE_DEFINITIONS[suite]?.standard ?? payload.standard ?? suite,
    officialComparable: SUITE_DEFINITIONS[suite]?.officialComparable ?? false,
    runId: latest.id,
    group: latest.group ?? payload.group ?? null,
    resultPath: latest.resultPath,
    ok: Boolean(payload.ok),
    status: payload.status ?? "unknown",
    reason: payload.reason ?? "",
    suiteOk: payload.ok === true,
    raw: payload
  };
}

function resolveRequiredSuites(mode) {
  switch (mode) {
    case "release":
      return RELEASE_REQUIRED_SUITES;
    case "community":
      return COMMUNITY_REQUIRED_SUITES;
    case "full":
      return FULL_REQUIRED_SUITES;
    default:
      throw new Error(`Unsupported --mode ${mode}. Use release|community|full`);
  }
}

async function main() {
  const cwd = process.cwd();
  const mode = parseArg("--mode", "release");
  const requiredSuites = resolveRequiredSuites(mode);
  const allSuites = Object.keys(SUITE_DEFINITIONS);

  const checks = [];
  for (const suite of allSuites) {
    checks.push(await loadLatestResult(cwd, suite));
  }

  const requiredSet = new Set(requiredSuites);
  const failedRequired = checks.filter((check) => requiredSet.has(check.suite) && !check.ok);

  const report = {
    ok: failedRequired.length === 0,
    mode,
    requiredSuites,
    knownSuites: allSuites,
    checks,
    failedCount: failedRequired.length,
    failedRequiredSuites: failedRequired.map((item) => ({
      suite: item.suite,
      status: item.status,
      reason: item.reason
    })),
    note:
      mode === "release"
        ? "release mode only enforces minimal smoke gate; use --mode community/full for stronger external-claim readiness"
        : "community/full mode enforces broader public benchmark evidence"
  };

  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
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
