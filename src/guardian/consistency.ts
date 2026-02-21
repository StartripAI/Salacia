import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { ConsistencyReport, ConsistencyViolation, Contract, Plan } from "../core/types.js";
import { getSalaciaPaths } from "../core/paths.js";
import { detectDrift } from "./drift.js";
import { SnapshotManager } from "./snapshot.js";

interface FingerprintEntry {
  artifact: string;
  stepId: string;
  expected: boolean;
  exists: boolean;
  hash: string | null;
  history: string[];
}

interface FingerprintFile {
  generatedAt: string;
  contractId: string;
  entries: Record<string, FingerprintEntry>;
  deletedArtifacts: string[];
}

interface ConsistencyOptions {
  autoSnapshotOnHighRisk?: boolean;
}

async function hashFile(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

function fingerprintPath(root: string): string {
  return path.join(getSalaciaPaths(root).progress, "feature-fingerprint.json");
}

function normalizeArtifactPath(root: string, artifact: string): string {
  return path.isAbsolute(artifact) ? artifact : path.join(root, artifact);
}

function isTrackableArtifact(artifact: string): boolean {
  return !artifact.includes("*") && !artifact.includes("?");
}

async function loadFingerprint(root: string): Promise<FingerprintFile | null> {
  const raw = await fs.readFile(fingerprintPath(root), "utf8").catch(() => "");
  if (!raw) return null;
  return JSON.parse(raw) as FingerprintFile;
}

async function saveFingerprint(root: string, data: FingerprintFile): Promise<void> {
  const fpPath = fingerprintPath(root);
  await fs.mkdir(path.dirname(fpPath), { recursive: true });
  await fs.writeFile(fpPath, JSON.stringify(data, null, 2), "utf8");
}

function hasHighRiskViolation(violations: ConsistencyViolation[]): boolean {
  return violations.some((violation) => violation.severity === "high");
}

export async function evaluateConsistency(
  contract: Contract,
  plan: Plan,
  root = process.cwd(),
  options: ConsistencyOptions = {}
): Promise<ConsistencyReport> {
  const previous = await loadFingerprint(root);
  const entries: Record<string, FingerprintEntry> = previous?.entries ? { ...previous.entries } : {};
  const deletedArtifacts = new Set(previous?.deletedArtifacts ?? []);
  const violations: ConsistencyViolation[] = [];
  const expectedArtifacts = new Set(
    plan.steps.flatMap((step) => step.expectedArtifacts.filter((artifact) => isTrackableArtifact(artifact)))
  );

  for (const step of plan.steps) {
    for (const artifact of step.expectedArtifacts) {
      if (!isTrackableArtifact(artifact)) continue;

      const absolutePath = normalizeArtifactPath(root, artifact);
      const exists = await fs
        .stat(absolutePath)
        .then((st) => st.isFile())
        .catch(() => false);
      const currentHash = exists ? await hashFile(absolutePath) : null;
      const previousEntry = entries[artifact];

      if (!exists) {
        if (previousEntry?.exists) {
          violations.push({
            code: "missing-artifact",
            severity: "high",
            message: `Expected artifact missing after execution: ${artifact}`,
            artifact,
            stepId: step.id
          });
        }
        deletedArtifacts.add(artifact);
      }

      if (exists && previousEntry?.hash && previousEntry.hash !== currentHash && previousEntry.history.includes(currentHash ?? "")) {
        violations.push({
          code: "unexpected-revert",
          severity: "high",
          message: `Artifact hash reverted to a historical version: ${artifact}`,
          artifact,
          stepId: step.id
        });
      }

      const history = previousEntry?.history ? [...previousEntry.history] : [];
      if (previousEntry?.hash && previousEntry.hash !== currentHash && previousEntry.hash) {
        history.push(previousEntry.hash);
      }

      entries[artifact] = {
        artifact,
        stepId: step.id,
        expected: true,
        exists,
        hash: currentHash,
        history: Array.from(new Set(history)).slice(-20)
      };

      if (exists) {
        deletedArtifacts.delete(artifact);
      }
    }
  }

  for (const artifact of Array.from(deletedArtifacts)) {
    if (expectedArtifacts.has(artifact)) continue;
    const absolutePath = normalizeArtifactPath(root, artifact);
    const revived = await fs
      .stat(absolutePath)
      .then((st) => st.isFile())
      .catch(() => false);
    if (!revived) continue;

    violations.push({
      code: "ghost-revival",
      severity: "medium",
      message: `Artifact revived unexpectedly outside current plan scope: ${artifact}`,
      artifact
    });
  }

  const drift = await detectDrift(contract, root);
  if (drift.severity === "high" || drift.severity === "medium") {
    violations.push({
      code: "contract-drift",
      severity: drift.severity === "high" ? "high" : "medium",
      message: `Contract drift severity=${drift.severity} score=${drift.score}`
    });
  }

  let score = 0;
  for (const violation of violations) {
    if (violation.severity === "high") score += 45;
    if (violation.severity === "medium") score += 25;
    if (violation.severity === "low") score += 10;
  }

  score += Math.floor(drift.score / 10);

  const report: ConsistencyReport = {
    ok: !hasHighRiskViolation(violations),
    score,
    violations,
    baselinePath: fingerprintPath(root)
  };

  if (options.autoSnapshotOnHighRisk && hasHighRiskViolation(violations)) {
    const snapshotManager = new SnapshotManager(root);
    const snapshot = await snapshotManager.createSnapshot("consistency-auto-block");
    report.snapshotId = snapshot.id;
    report.suggestion =
      "High-risk consistency violation detected. Execution blocked; use reported snapshot and rollback before retry.";
  }

  await saveFingerprint(root, {
    generatedAt: new Date().toISOString(),
    contractId: contract.identity.id,
    entries,
    deletedArtifacts: Array.from(deletedArtifacts)
  });

  return report;
}
