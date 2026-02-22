import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { createContractFromVibe } from "../core/contract.js";
import { ensureSalaciaDirs } from "../core/paths.js";
import { derivePlan } from "../core/plan.js";
import type {
  IntentIR,
  SuperiorityAuditCheckResult,
  SuperiorityAuditCheckSpec,
  SuperiorityAuditProfile,
  SuperiorityAuditReport,
  SuperiorityProbeId
} from "../core/types.js";
import { evaluateConsistency } from "../guardian/consistency.js";
import { compilePromptInput } from "../prompt/compile.js";
import { runMetamorphicTests } from "../prompt/metamorphic.js";
import { optimizePrompts } from "../prompt/optimize.js";

const execFileAsync = promisify(execFile);

const PROBE_IDS = [
  "prompt_compiler_pipeline",
  "active_disambiguation",
  "metamorphic_guard",
  "prompt_optimizer_auditability",
  "consistency_safety_net",
  "dual_convergence_gates",
  "trellis_mapping_doc",
  "clean_room_policy_doc",
  "snapshot_restore_test_coverage",
  "json_cli_contract"
] as const;

const CHECK_SCHEMA = z.object({
  id: z.string().min(1),
  probe: z.enum(PROBE_IDS),
  weight: z.number().int().min(1),
  required: z.boolean().default(false),
  strengthSignal: z.boolean().default(false),
  description: z.string().optional()
});

const PROFILE_SCHEMA = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  baselineScore: z.number().min(0),
  requiredScore: z.number().min(0),
  requiredMargin: z.number().min(0),
  minimumStrengthSignals: z.number().int().min(0),
  checks: z.array(CHECK_SCHEMA).min(1)
});

const DEFAULT_PROFILE_RELATIVE_PATH = path.join("docs", "benchmarks", "trellis-baseline.v1.json");

interface ProbeResult {
  passed: boolean;
  summary: string;
  evidenceRefs: string[];
  metrics?: Record<string, number | string | boolean>;
}

export interface RunSuperiorityAuditOptions {
  cwd?: string;
  profilePath?: string;
}

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

async function loadProfile(profilePath: string): Promise<SuperiorityAuditProfile> {
  const raw = await fs.readFile(profilePath, "utf8");
  const parsed = PROFILE_SCHEMA.parse(JSON.parse(raw));
  return {
    ...parsed,
    checks: parsed.checks.map((check) => ({
      ...check,
      required: check.required ?? false,
      strengthSignal: check.strengthSignal ?? false
    }))
  } as SuperiorityAuditProfile;
}

async function probePromptCompilerPipeline(cwd: string): Promise<ProbeResult> {
  const compiled = await compilePromptInput("build a robust todo app and keep rollback path", { cwd });
  const passed =
    compiled.ir.goals.length > 0 &&
    compiled.ir.constraints.length > 0 &&
    compiled.ir.acceptanceCriteria.length > 0 &&
    compiled.metamorphic.passed;

  return {
    passed,
    summary: passed
      ? "Prompt pipeline compiled goals/constraints/acceptance and passed metamorphic checks"
      : "Prompt pipeline did not produce complete IR or metamorphic checks failed",
    evidenceRefs: ["src/prompt/compile.ts", "src/prompt/metamorphic.ts"],
    metrics: {
      goals: compiled.ir.goals.length,
      constraints: compiled.ir.constraints.length,
      acceptance: compiled.ir.acceptanceCriteria.length,
      diagnostics: compiled.diagnostics.length,
      metamorphicPassed: compiled.metamorphic.passed
    }
  };
}

async function probeActiveDisambiguation(cwd: string): Promise<ProbeResult> {
  const compiled = await compilePromptInput("delete production auth database records quickly", { cwd });
  const passed = compiled.ir.risk.score >= 6 && compiled.question !== null && compiled.question.options.length >= 2;

  return {
    passed,
    summary: passed
      ? "High-risk prompt triggered single-question disambiguation"
      : "High-risk prompt did not trigger expected disambiguation behavior",
    evidenceRefs: ["src/prompt/disambiguate.ts", "src/prompt/compile.ts"],
    metrics: {
      riskScore: compiled.ir.risk.score,
      hasQuestion: compiled.question !== null,
      options: compiled.question?.options.length ?? 0
    }
  };
}

async function probeMetamorphicGuard(cwd: string): Promise<ProbeResult> {
  const compiled = await compilePromptInput("implement feature and do not modify billing", { cwd });
  const broken: IntentIR = {
    ...compiled.ir,
    constraints: [],
    nonGoals: []
  };
  const test = runMetamorphicTests(compiled.baseline, broken);
  const droppedNonGoal = test.checks.some((check) => check.ruleId === "non-goal-preservation" && !check.passed);
  const passed = !test.passed && droppedNonGoal;

  return {
    passed,
    summary: passed
      ? "Metamorphic guard detected semantic drift from weakened constraints/non-goals"
      : "Metamorphic guard did not catch expected semantic drift pattern",
    evidenceRefs: ["src/prompt/metamorphic.ts", "tests/prompt.test.ts"],
    metrics: {
      overallPassed: test.passed,
      droppedNonGoal
    }
  };
}

async function probePromptOptimizerAuditability(): Promise<ProbeResult> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-audit-opt-"));
  const salacia = await ensureSalaciaDirs(root);
  await fs.writeFile(
    path.join(salacia.journal, "run-1.json"),
    JSON.stringify({ error: "No 2/3 majority. Human approval required." }),
    "utf8"
  );
  await fs.writeFile(
    path.join(salacia.journal, "run-2.json"),
    JSON.stringify({ error: "No 2/3 majority. Human approval required." }),
    "utf8"
  );

  const report = await optimizePrompts({ cwd: root, fromJournal: true });
  const patchDir = path.join(salacia.journal, "prompt-patches");
  const files = await fs.readdir(patchDir).catch(() => []);
  const hasPatch = files.some((file) => file.endsWith(".json") && file.startsWith("prompt-patch-"));
  const hasRollback = files.some((file) => file.endsWith(".json") && file.startsWith("rollback-"));
  const passed = report.accepted > 0 && hasPatch && hasRollback;

  return {
    passed,
    summary: passed
      ? "Prompt optimizer generated auditable patch + rollback artifacts"
      : "Prompt optimizer failed to produce auditable patch artifacts",
    evidenceRefs: ["src/prompt/optimize.ts", ".salacia/journal/prompt-patches/*.json"],
    metrics: {
      considered: report.considered,
      accepted: report.accepted,
      patchFiles: files.length,
      hasRollback
    }
  };
}

async function probeConsistencySafetyNet(): Promise<ProbeResult> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-audit-consistency-"));
  await git(root, "init");
  await git(root, "config", "user.email", "salacia-audit@example.com");
  await git(root, "config", "user.name", "Salacia Audit");
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "artifact.txt"), "v1\n", "utf8");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "init");

  const contract = createContractFromVibe("consistency safety net audit", "audit-repo");
  contract.scope.inScope = ["src/**"];
  contract.plan.steps = [
    {
      id: "artifact-step",
      riskLevel: "medium",
      expectedArtifacts: ["src/artifact.txt"],
      verification: ["node -e \"process.exit(0)\""]
    }
  ];

  const plan = derivePlan(contract);
  const baseline = await evaluateConsistency(contract, plan, root, {
    autoSnapshotOnHighRisk: true
  });

  await fs.unlink(path.join(root, "src", "artifact.txt"));
  const regression = await evaluateConsistency(contract, plan, root, {
    autoSnapshotOnHighRisk: true
  });

  const missingArtifact = regression.violations.some((violation) => violation.code === "missing-artifact");
  const passed = baseline.ok && !regression.ok && missingArtifact && typeof regression.snapshotId === "string";

  return {
    passed,
    summary: passed
      ? "Consistency safety net blocked high-risk regression and created rollback snapshot"
      : "Consistency safety net failed to block or evidence high-risk regression",
    evidenceRefs: ["src/guardian/consistency.ts", "src/harness/incremental.ts"],
    metrics: {
      baselineOk: baseline.ok,
      regressionOk: regression.ok,
      missingArtifact,
      hasSnapshotId: typeof regression.snapshotId === "string"
    }
  };
}

async function probeDualConvergenceGates(cwd: string): Promise<ProbeResult> {
  const cliPath = path.join(cwd, "src", "cli", "index.ts");
  const raw = await fs.readFile(cliPath, "utf8");

  const hasPlanGate = /stage:\s*"plan"/.test(raw) && /preDecision\.winner !== "approve"/.test(raw);
  const hasExecGate = /stage:\s*"exec"/.test(raw) && /postDecision\.winner === "approve"/.test(raw);
  const passed = hasPlanGate && hasExecGate;

  return {
    passed,
    summary: passed ? "Execute flow enforces convergence at both plan and exec stages" : "Dual convergence stage gates missing",
    evidenceRefs: ["src/cli/index.ts", "src/core/converge.ts"],
    metrics: {
      hasPlanGate,
      hasExecGate
    }
  };
}

async function probeTrellisMappingDoc(cwd: string): Promise<ProbeResult> {
  const file = path.join(cwd, "docs", "TRELLIS_MAPPING.md");
  const raw = await fs.readFile(file, "utf8").catch(() => "");
  const passed = raw.includes("Capability Mapping") && raw.includes("Design Deltas") && raw.includes("Evidence Paths");
  return {
    passed,
    summary: passed ? "Trellis capability mapping documented with deltas and evidence paths" : "Trellis mapping documentation is incomplete",
    evidenceRefs: ["docs/TRELLIS_MAPPING.md"]
  };
}

async function probeCleanRoomPolicyDoc(cwd: string): Promise<ProbeResult> {
  const file = path.join(cwd, "docs", "CLEAN_ROOM_REUSE.md");
  const raw = await fs.readFile(file, "utf8").catch(() => "");
  const passed = raw.includes("No direct code transfer") && raw.includes("clean-room");
  return {
    passed,
    summary: passed ? "Clean-room reuse policy explicitly forbids code transfer" : "Clean-room reuse policy requirements are incomplete",
    evidenceRefs: ["docs/CLEAN_ROOM_REUSE.md"]
  };
}

async function probeSnapshotRestoreTestCoverage(cwd: string): Promise<ProbeResult> {
  const file = path.join(cwd, "tests", "guardian.test.ts");
  const raw = await fs.readFile(file, "utf8").catch(() => "");
  const hasRestoreTest = raw.includes("restores snapshot and verifies checksum mismatch handling");
  const hasChecksumAssertion = raw.includes("Snapshot checksum mismatch: working diff");
  const passed = hasRestoreTest && hasChecksumAssertion;

  return {
    passed,
    summary: passed ? "Snapshot restore path and checksum mismatch are unit-tested" : "Snapshot restore unit test coverage is incomplete",
    evidenceRefs: ["tests/guardian.test.ts"],
    metrics: {
      hasRestoreTest,
      hasChecksumAssertion
    }
  };
}

async function probeJsonCliContract(cwd: string): Promise<ProbeResult> {
  const file = path.join(cwd, "src", "cli", "index.ts");
  const raw = await fs.readFile(file, "utf8");
  const commands = ["plan", "prompt", "converge", "validate", "guard", "execute", "snapshot", "rollback", "status", "adapters", "doctor", "audit"];
  const jsonOptionCount = (raw.match(/\.option\("--json",/g) ?? []).length;
  const hasAllCommandBlocks = commands.every((command) => raw.includes(`.command("${command}")`));
  const passed = hasAllCommandBlocks && jsonOptionCount >= 10;

  return {
    passed,
    summary: passed ? "CLI contract exposes deterministic JSON mode across operational commands" : "CLI JSON contract is incomplete",
    evidenceRefs: ["src/cli/index.ts"],
    metrics: {
      jsonOptionCount,
      commandCount: commands.length,
      hasAllCommandBlocks
    }
  };
}

async function runProbe(probe: SuperiorityProbeId, cwd: string): Promise<ProbeResult> {
  switch (probe) {
    case "prompt_compiler_pipeline":
      return probePromptCompilerPipeline(cwd);
    case "active_disambiguation":
      return probeActiveDisambiguation(cwd);
    case "metamorphic_guard":
      return probeMetamorphicGuard(cwd);
    case "prompt_optimizer_auditability":
      return probePromptOptimizerAuditability();
    case "consistency_safety_net":
      return probeConsistencySafetyNet();
    case "dual_convergence_gates":
      return probeDualConvergenceGates(cwd);
    case "trellis_mapping_doc":
      return probeTrellisMappingDoc(cwd);
    case "clean_room_policy_doc":
      return probeCleanRoomPolicyDoc(cwd);
    case "snapshot_restore_test_coverage":
      return probeSnapshotRestoreTestCoverage(cwd);
    case "json_cli_contract":
      return probeJsonCliContract(cwd);
    default:
      return {
        passed: false,
        summary: `Unknown probe: ${probe}`,
        evidenceRefs: []
      };
  }
}

function toCheckResult(spec: SuperiorityAuditCheckSpec, probe: ProbeResult): SuperiorityAuditCheckResult {
  return {
    id: spec.id,
    probe: spec.probe,
    passed: probe.passed,
    weight: spec.weight,
    awarded: probe.passed ? spec.weight : 0,
    required: spec.required,
    strengthSignal: spec.strengthSignal,
    summary: probe.summary,
    evidenceRefs: probe.evidenceRefs,
    ...(probe.metrics ? { metrics: probe.metrics } : {})
  };
}

export async function runSuperiorityAudit(options: RunSuperiorityAuditOptions = {}): Promise<SuperiorityAuditReport> {
  const cwd = options.cwd ?? process.cwd();
  const profilePath = path.resolve(cwd, options.profilePath ?? DEFAULT_PROFILE_RELATIVE_PATH);
  const profile = await loadProfile(profilePath);

  const checks: SuperiorityAuditCheckResult[] = [];
  for (const check of profile.checks) {
    const probe = await runProbe(check.probe, cwd);
    checks.push(toCheckResult(check, probe));
  }

  const maxScore = checks.reduce((total, check) => total + check.weight, 0);
  const score = checks.reduce((total, check) => total + check.awarded, 0);
  const passRate = maxScore === 0 ? 0 : Number((score / maxScore).toFixed(4));
  const strengthSignals = checks.filter((check) => check.strengthSignal && check.passed).length;
  const requiredFailures = checks.filter((check) => check.required && !check.passed).map((check) => check.id);
  const failedChecks = checks.filter((check) => !check.passed).map((check) => check.id);
  const baselineTargetScore = Math.max(profile.requiredScore, profile.baselineScore + profile.requiredMargin);

  const strongerThanBaseline =
    requiredFailures.length === 0 &&
    score >= profile.requiredScore &&
    score >= baselineTargetScore &&
    strengthSignals >= profile.minimumStrengthSignals;

  const paths = await ensureSalaciaDirs(cwd);
  const reportPath = path.join(paths.journal, `superiority-audit-${Date.now()}.json`);

  const report: SuperiorityAuditReport = {
    generatedAt: new Date().toISOString(),
    profileId: profile.id,
    profileName: profile.name,
    profileVersion: profile.version,
    profilePath,
    baselineScore: profile.baselineScore,
    requiredScore: profile.requiredScore,
    baselineTargetScore,
    score,
    maxScore,
    passRate,
    strengthSignals,
    minimumStrengthSignals: profile.minimumStrengthSignals,
    strongerThanBaseline,
    requiredFailures,
    failedChecks,
    checks,
    reportPath
  };

  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  return report;
}

