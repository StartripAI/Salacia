import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { IntentIR, PromptOptimizationReport, PromptPatch } from "../core/types.js";
import { getSalaciaPaths } from "../core/paths.js";
import { buildRisk } from "./ir.js";
import { runMetamorphicTests } from "./metamorphic.js";

export interface PromptOptimizationOptions {
  cwd?: string;
  fromJournal?: boolean;
  sampleInput?: string;
}

interface PatchSignal {
  key: string;
  count: number;
  rationale: string;
  operations: string[];
  evidenceRefs: string[];
}

async function walkJsonFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkJsonFiles(full)));
      continue;
    }
    if (entry.isFile() && full.endsWith(".json")) {
      out.push(full);
    }
  }

  return out;
}

function baselineIntent(sampleInput: string): IntentIR {
  return {
    id: "intent-baseline",
    source: sampleInput,
    compiledAt: new Date().toISOString(),
    goals: [sampleInput],
    constraints: ["Keep implementation auditable and reversible"],
    nonGoals: ["Do not change unrelated modules"],
    assumptions: ["Repository and toolchain are available"],
    acceptanceCriteria: ["Requested behavior is delivered and verified"],
    affectedAreas: ["src/**"],
    riskTags: ["baseline"],
    risk: buildRisk(1, 1, 1),
    evidenceRefs: []
  };
}

function applyPatch(intent: IntentIR, operations: string[]): IntentIR {
  const updated: IntentIR = {
    ...intent,
    constraints: [...intent.constraints],
    acceptanceCriteria: [...intent.acceptanceCriteria],
    riskTags: [...intent.riskTags]
  };

  for (const op of operations) {
    if (op.startsWith("constraint:")) {
      updated.constraints.push(op.replace("constraint:", "").trim());
    }
    if (op.startsWith("acceptance:")) {
      updated.acceptanceCriteria.push(op.replace("acceptance:", "").trim());
    }
    if (op.startsWith("tag:")) {
      updated.riskTags.push(op.replace("tag:", "").trim());
    }
  }

  updated.constraints = Array.from(new Set(updated.constraints));
  updated.acceptanceCriteria = Array.from(new Set(updated.acceptanceCriteria));
  updated.riskTags = Array.from(new Set(updated.riskTags));
  return updated;
}

function scoreSignal(content: string, filePath: string, counters: Map<string, PatchSignal>): void {
  const patterns: Array<{
    key: string;
    regex: RegExp;
    rationale: string;
    operations: string[];
  }> = [
    {
      key: "bootstrap-init",
      regex: /No contract found|Missing plan or contract|Run salacia plan/i,
      rationale: "Users frequently miss initialization/order prerequisites",
      operations: [
        "constraint:Initialize salacia runtime before planning or executing",
        "acceptance:Init/plan prerequisites are validated before execution",
        "tag:workflow-prerequisite"
      ]
    },
    {
      key: "convergence-clarity",
      regex: /No 2\/3 majority|Human approval required|abstain/i,
      rationale: "Convergence failures indicate ambiguous intent and missing acceptance boundaries",
      operations: [
        "constraint:Provide explicit acceptance criteria before convergence",
        "acceptance:Convergence inputs include structured acceptance and risks",
        "tag:convergence-hardening"
      ]
    },
    {
      key: "security-guardrail",
      regex: /secret|token|protected path|security/i,
      rationale: "Security-related incidents indicate missing guardrail clauses",
      operations: [
        "constraint:Never persist plaintext secrets in repo or logs",
        "acceptance:Protected paths remain unchanged unless approved",
        "tag:security-critical"
      ]
    },
    {
      key: "drift-control",
      regex: /drift|outOfScopeChanges|contract-drift|unexpected-revert|ghost-revival/i,
      rationale: "Drift signals indicate scope/control weakness",
      operations: [
        "constraint:Maintain feature fingerprint consistency per step",
        "acceptance:No unexpected revert or ghost revival is detected",
        "tag:consistency-safety-net"
      ]
    }
  ];

  for (const pattern of patterns) {
    if (!pattern.regex.test(content)) continue;

    const existing = counters.get(pattern.key);
    if (existing) {
      existing.count += 1;
      existing.evidenceRefs.push(filePath);
    } else {
      counters.set(pattern.key, {
        key: pattern.key,
        count: 1,
        rationale: pattern.rationale,
        operations: pattern.operations,
        evidenceRefs: [filePath]
      });
    }
  }
}

function patchFromSignal(signal: PatchSignal, root: string): PromptPatch {
  const digest = createHash("sha256")
    .update(`${signal.key}:${signal.count}:${signal.operations.join("|")}`)
    .digest("hex")
    .slice(0, 12);

  return {
    id: `prompt-patch-${signal.key}-${digest}`,
    createdAt: new Date().toISOString(),
    appliesTo: signal.key,
    rationale: signal.rationale,
    operations: signal.operations,
    score: signal.count,
    evidenceRefs: signal.evidenceRefs,
    rollbackRef: path.join(root, ".salacia", "journal", "prompt-patches", `rollback-${signal.key}-${digest}.json`)
  };
}

export async function optimizePrompts(options: PromptOptimizationOptions = {}): Promise<PromptOptimizationReport> {
  const cwd = options.cwd ?? process.cwd();
  const salaciaPaths = getSalaciaPaths(cwd);
  const patchDir = path.join(salaciaPaths.journal, "prompt-patches");
  await fs.mkdir(patchDir, { recursive: true });

  const report: PromptOptimizationReport = {
    generatedAt: new Date().toISOString(),
    considered: 0,
    accepted: 0,
    patches: [],
    skipped: []
  };

  if (!options.fromJournal) {
    report.skipped.push("from-journal flag is required for optimization");
    return report;
  }

  const files = await walkJsonFiles(salaciaPaths.journal);
  const counters = new Map<string, PatchSignal>();

  for (const filePath of files) {
    const raw = await fs.readFile(filePath, "utf8").catch(() => "");
    if (!raw) continue;
    scoreSignal(raw, filePath, counters);
  }

  report.considered = counters.size;

  for (const signal of counters.values()) {
    const patch = patchFromSignal(signal, cwd);
    const base = baselineIntent(options.sampleInput ?? "Improve Salacia delivery quality");
    const candidate = applyPatch(base, patch.operations);
    const metamorphic = runMetamorphicTests(base, candidate);
    const positiveGain = signal.count >= 2;

    if (!positiveGain) {
      report.skipped.push(`${signal.key}: insufficient repeated evidence (N<2)`);
      continue;
    }

    if (!metamorphic.passed) {
      report.skipped.push(`${signal.key}: failed metamorphic testing`);
      continue;
    }

    const patchPath = path.join(patchDir, `${patch.id}.json`);
    const rollbackPath = patch.rollbackRef;

    await fs.writeFile(
      patchPath,
      JSON.stringify(
        {
          ...patch,
          validatedAt: new Date().toISOString(),
          metamorphic
        },
        null,
        2
      ),
      "utf8"
    );

    await fs.writeFile(
      rollbackPath,
      JSON.stringify(
        {
          patchId: patch.id,
          action: "delete-patch",
          patchPath,
          createdAt: new Date().toISOString()
        },
        null,
        2
      ),
      "utf8"
    );

    report.patches.push(patch);
    report.accepted += 1;
  }

  return report;
}
