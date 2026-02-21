import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createContractFromVibe } from "../src/core/contract.js";
import { derivePlan } from "../src/core/plan.js";
import { evaluateConsistency } from "../src/guardian/consistency.js";
import { detectDrift } from "../src/guardian/drift.js";
import { ProgressTracker } from "../src/guardian/progress.js";
import { SnapshotManager } from "../src/guardian/snapshot.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

describe("guardian", () => {
  it("scores drift with scope/protected thresholds", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-drift-"));
    await git(root, "init");
    await git(root, "config", "user.email", "salacia@example.com");
    await git(root, "config", "user.name", "Salacia Test");

    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.mkdir(path.join(root, "secrets"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "a.ts"), "export const a = 1;\n", "utf8");
    await fs.writeFile(path.join(root, "secrets", "token.txt"), "safe\n", "utf8");
    await git(root, "add", ".");
    await git(root, "commit", "-m", "init");

    await fs.writeFile(path.join(root, "src", "a.ts"), "export const a = 2;\n", "utf8");
    await fs.writeFile(path.join(root, "secrets", "token.txt"), "changed\n", "utf8");

    const contract = createContractFromVibe("guardian test", "repo");
    contract.scope.inScope = ["src/**"];
    contract.guardrails.protectedPaths = ["secrets/"];

    const drift = await detectDrift(contract, root);
    expect(drift.score).toBeGreaterThanOrEqual(60);
    expect(drift.severity === "medium" || drift.severity === "high").toBe(true);
    expect(drift.protectedPathTouches).toContain("secrets/token.txt");
  });

  it("creates snapshot metadata with checksums", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-snapshot-"));
    await git(root, "init");
    await git(root, "config", "user.email", "salacia@example.com");
    await git(root, "config", "user.name", "Salacia Test");

    await fs.writeFile(path.join(root, "file.txt"), "base\n", "utf8");
    await git(root, "add", ".");
    await git(root, "commit", "-m", "base");

    await fs.writeFile(path.join(root, "file.txt"), "changed\n", "utf8");

    const manager = new SnapshotManager(root);
    const snapshot = await manager.createSnapshot("test");
    expect(snapshot.checksums.workingDiffSha256).toHaveLength(64);
    expect(snapshot.checksums.stagedDiffSha256).toHaveLength(64);
  });

  it("restores snapshot and verifies checksum mismatch handling", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-snapshot-restore-"));
    await git(root, "init");
    await git(root, "config", "user.email", "salacia@example.com");
    await git(root, "config", "user.name", "Salacia Test");

    await fs.writeFile(path.join(root, "file.txt"), "base\n", "utf8");
    await git(root, "add", ".");
    await git(root, "commit", "-m", "base");

    await fs.writeFile(path.join(root, "file.txt"), "changed\n", "utf8");
    const manager = new SnapshotManager(root);
    const snapshot = await manager.createSnapshot("restore-test");

    await manager.restoreSnapshot(snapshot.id);
    const restored = await fs.readFile(path.join(root, "file.txt"), "utf8");
    expect(restored.replace(/\r\n/g, "\n")).toBe("base\n");

    await fs.writeFile(snapshot.patchPath, "tampered", "utf8");
    await expect(manager.restoreSnapshot(snapshot.id)).rejects.toThrow("Snapshot checksum mismatch: working diff");
  });

  it("detects high-risk consistency regression for missing artifacts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-consistency-"));
    await git(root, "init");
    await git(root, "config", "user.email", "salacia@example.com");
    await git(root, "config", "user.name", "Salacia Test");

    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "artifact.txt"), "v1\n", "utf8");
    await git(root, "add", ".");
    await git(root, "commit", "-m", "init");

    const contract = createContractFromVibe("consistency guard test", "repo");
    contract.scope.inScope = ["src/**"];
    contract.plan.steps[0] = {
      id: "artifact-step",
      riskLevel: "medium",
      expectedArtifacts: ["src/artifact.txt"],
      verification: ["node -e \"process.exit(0)\""]
    };
    const plan = derivePlan(contract);

    const baseline = await evaluateConsistency(contract, plan, root, {
      autoSnapshotOnHighRisk: true
    });
    expect(baseline.ok).toBe(true);

    await fs.unlink(path.join(root, "src", "artifact.txt"));
    const regression = await evaluateConsistency(contract, plan, root, {
      autoSnapshotOnHighRisk: true
    });
    expect(regression.ok).toBe(false);
    expect(regression.violations.some((v) => v.code === "missing-artifact")).toBe(true);
    expect(typeof regression.snapshotId).toBe("string");
  });

  it("tracks progress state", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-progress-"));
    const tracker = new ProgressTracker(root);

    await tracker.initializeFromPlan({
      contractId: "c-1",
      generatedAt: new Date().toISOString(),
      summary: "test",
      steps: [
        {
          id: "step-1",
          riskLevel: "low",
          expectedArtifacts: [],
          verification: ["node -e \"process.exit(0)\""]
        }
      ]
    });

    await tracker.updateStep("step-1", "done", true);
    const progress = await tracker.read();
    expect(progress?.items[0]?.status).toBe("done");
    expect(progress?.items[0]?.passes).toBe(true);
  });
});
