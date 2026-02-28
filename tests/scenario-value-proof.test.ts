/**
 * Scenario Tests — "Does Salacia actually catch bad things?"
 *
 * These tests prove Salacia's value proposition. They don't need real LLMs.
 * Each scenario injects a known bad behavior and verifies the guardian/convergence layer catches it.
 *
 * - Scenario 1: Scope Guard — LLM touches files outside contract scope
 * - Scenario 2: Rollback Recovery — execution fails, rollback restores perfectly
 * - Scenario 3: Step Regression — Step 2 deletes Step 1's artifact, guardian blocks
 * - Scenario 4: Convergence Catch — advisor disagreement blocks advancement
 * - Scenario 5: Protected Path Guard — LLM touches protected files
 * - Scenario 6: Full Pipeline Happy Path — vibe to verify, no breaks
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createContractFromVibe, saveContract } from "../src/core/contract.js";
import { resolveConvergence } from "../src/core/converge.js";
import { derivePlan, savePlan } from "../src/core/plan.js";
import { ensureSalaciaDirs } from "../src/core/paths.js";
import { detectDrift } from "../src/guardian/drift.js";
import { evaluateConsistency } from "../src/guardian/consistency.js";
import { SnapshotManager } from "../src/guardian/snapshot.js";
import { RollbackEngine } from "../src/guardian/rollback.js";
import { runVerification } from "../src/guardian/verify.js";
import type { AdvisorOpinion, Contract, Plan } from "../src/core/types.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd, maxBuffer: 8 * 1024 * 1024 });
}

async function initGitRepo(root: string): Promise<void> {
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "test@salacia.dev"]);
  await git(root, ["config", "user.name", "Salacia Test"]);
}

async function seedRepo(root: string, files: Record<string, string>): Promise<void> {
  for (const [filePath, content] of Object.entries(files)) {
    const full = path.join(root, filePath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf8");
  }
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "seed"]);
}

function makeContract(overrides: {
  inScope?: string[];
  outOfScope?: string[];
  protectedPaths?: string[];
  verifyCmd?: string;
}): Contract {
  const contract = createContractFromVibe("scenario test", "scenario-repo");
  if (overrides.inScope) contract.scope.inScope = overrides.inScope;
  if (overrides.outOfScope) contract.scope.outOfScope = overrides.outOfScope;
  if (overrides.protectedPaths) contract.guardrails.protectedPaths = overrides.protectedPaths;
  if (overrides.verifyCmd) contract.verification.commands = [overrides.verifyCmd];
  return contract;
}

// ─────────────────────────────────────────────────────────────────────
// Scenario 1: Scope Guard — LLM touches files outside contract scope
// ─────────────────────────────────────────────────────────────────────
describe("Scenario 1: Scope Guard", () => {
  it("detects out-of-scope file changes and raises drift", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-s1-"));
    await initGitRepo(root);
    await seedRepo(root, { "src/index.ts": "export const ok = true;\n" });

    const contract = makeContract({ inScope: ["src/"] });

    // Simulate LLM creating files OUTSIDE scope
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.writeFile(path.join(root, "docs/hack.md"), "rogue file", "utf8");
    await fs.writeFile(path.join(root, "config.yml"), "rogue config", "utf8");

    const drift = await detectDrift(contract, root);

    expect(drift.outOfScopeChanges.length).toBeGreaterThanOrEqual(2);
    expect(drift.outOfScopeChanges).toContain("docs/hack.md");
    expect(drift.outOfScopeChanges).toContain("config.yml");
    expect(drift.severity).not.toBe("none");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Scenario 2: Rollback Recovery — perfect restoration after failure
// ─────────────────────────────────────────────────────────────────────
describe("Scenario 2: Rollback Recovery", () => {
  it("restores repo to exact snapshot state after failed execution", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-s2-"));
    await initGitRepo(root);
    await seedRepo(root, {
      "src/auth.ts": "export function login() { return true; }\n",
      "src/db.ts": "export const pool = {};\n",
      "README.md": "# My App\n"
    });

    // Take snapshot
    const snapshotManager = new SnapshotManager(root);
    const snapshot = await snapshotManager.createSnapshot("pre-exec");

    // Simulate LLM trashing the repo
    await fs.writeFile(path.join(root, "src/auth.ts"), "BROKEN CODE", "utf8");
    await fs.rm(path.join(root, "src/db.ts"));
    await fs.writeFile(path.join(root, "malware.js"), "bad stuff", "utf8");
    await fs.writeFile(path.join(root, "README.md"), "OVERWRITTEN", "utf8");

    // Verify repo is trashed
    const trashedAuth = await fs.readFile(path.join(root, "src/auth.ts"), "utf8");
    expect(trashedAuth).toBe("BROKEN CODE");

    // Rollback
    const rollbackEngine = new RollbackEngine(snapshotManager);
    await rollbackEngine.rollback(snapshot.id, { cwd: root });
    // Verify perfect restoration
    const restoredAuth = await fs.readFile(path.join(root, "src/auth.ts"), "utf8");
    const restoredDb = await fs.readFile(path.join(root, "src/db.ts"), "utf8");
    const restoredReadme = await fs.readFile(path.join(root, "README.md"), "utf8");

    expect(restoredAuth).toBe("export function login() { return true; }\n");
    expect(restoredDb).toBe("export const pool = {};\n");
    expect(restoredReadme).toBe("# My App\n");

    // Malware file should be gone
    const malwareExists = await fs.stat(path.join(root, "malware.js")).catch(() => null);
    expect(malwareExists).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Scenario 3: Step Regression — Step 2 destroys Step 1's artifact
// ─────────────────────────────────────────────────────────────────────
describe("Scenario 3: Step Regression", () => {
  it("detects missing-artifact when Step 2 deletes Step 1's output", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-s3-"));
    await initGitRepo(root);
    await seedRepo(root, { "src/base.ts": "base\n" });
    await ensureSalaciaDirs(root);

    const contract = makeContract({ inScope: ["src/"] });
    contract.plan.steps = [
      {
        id: "step-1-create-auth",
        riskLevel: "low",
        expectedArtifacts: ["src/auth.ts"],
        verification: ['node -e "process.exit(0)"']
      },
      {
        id: "step-2-add-routes",
        riskLevel: "low",
        expectedArtifacts: ["src/auth.ts", "src/routes.ts"],
        verification: ['node -e "process.exit(0)"']
      }
    ];
    const plan = derivePlan(contract);

    // Step 1 succeeds: create auth.ts
    await fs.writeFile(path.join(root, "src/auth.ts"), "export function login() {}\n", "utf8");

    // Run consistency after Step 1 — should be fine
    const report1 = await evaluateConsistency(contract, plan, root);
    expect(report1.ok).toBe(true);

    // Step 2 "accidentally" deletes auth.ts (regression!)
    await fs.rm(path.join(root, "src/auth.ts"));
    await fs.writeFile(path.join(root, "src/routes.ts"), "export const routes = [];\n", "utf8");

    // Run consistency after Step 2 — should catch the regression
    const report2 = await evaluateConsistency(contract, plan, root);

    expect(report2.ok).toBe(false);
    const missingViolation = report2.violations.find((v) => v.code === "missing-artifact");
    expect(missingViolation).toBeDefined();
    expect(missingViolation!.artifact).toBe("src/auth.ts");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Scenario 4: Convergence Catch — advisor disagreement blocks progress
// ─────────────────────────────────────────────────────────────────────
describe("Scenario 4: Convergence Catch", () => {
  it("blocks advancement when advisors disagree (no 2/3 majority)", () => {
    const opinions: AdvisorOpinion[] = [
      { advisor: "claude", vote: "approve", summary: "Looks good", parseStatus: "ok", evidenceRef: "claude.json" },
      { advisor: "gemini", vote: "reject", summary: "Missing tests", parseStatus: "ok", evidenceRef: "gemini.json" },
      { advisor: "codex", vote: "abstain", summary: "Uncertain", parseStatus: "ok" }
    ];

    const decision = resolveConvergence("plan", opinions);

    expect(decision.winner).not.toBe("approve");
    expect(decision.requiresHumanApproval).toBe(true);
    expect(decision.conflicts.length).toBeGreaterThan(0);
  });

  it("rejects when 2+ advisors vote reject", () => {
    const opinions: AdvisorOpinion[] = [
      { advisor: "claude", vote: "reject", summary: "Dangerous", parseStatus: "ok", evidenceRef: "c.json" },
      { advisor: "gemini", vote: "reject", summary: "Scope creep", parseStatus: "ok", evidenceRef: "g.json" },
      { advisor: "codex", vote: "approve", summary: "OK by me", parseStatus: "ok" }
    ];

    const decision = resolveConvergence("plan", opinions);

    expect(decision.winner).toBe("reject");
  });

  it("approves only when 2+ advisors vote approve", () => {
    const opinions: AdvisorOpinion[] = [
      { advisor: "claude", vote: "approve", summary: "Solid", parseStatus: "ok", evidenceRef: "c.json" },
      { advisor: "gemini", vote: "approve", summary: "LGTM", parseStatus: "ok", evidenceRef: "g.json" },
      { advisor: "codex", vote: "abstain", summary: "No opinion", parseStatus: "ok" }
    ];

    const decision = resolveConvergence("plan", opinions);

    expect(decision.winner).toBe("approve");
    expect(decision.requiresHumanApproval).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Scenario 5: Protected Path Guard — LLM touches protected files
// ─────────────────────────────────────────────────────────────────────
describe("Scenario 5: Protected Path Guard", () => {
  it("raises high-severity drift when protected paths are modified", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-s5-"));
    await initGitRepo(root);
    await seedRepo(root, {
      "src/index.ts": "export const ok = true;\n",
      ".env": "SECRET=abc123\n",
      "secrets/key.pem": "-----BEGIN RSA-----\n"
    });

    const contract = makeContract({
      inScope: ["src/"],
      protectedPaths: [".env", "secrets/"]
    });

    // Simulate LLM touching protected files
    await fs.writeFile(path.join(root, ".env"), "SECRET=HACKED\n", "utf8");
    await fs.writeFile(path.join(root, "secrets/key.pem"), "LEAKED\n", "utf8");

    const drift = await detectDrift(contract, root);

    expect(drift.protectedPathTouches.length).toBeGreaterThanOrEqual(2);
    expect(drift.severity).toBe("high");
    expect(drift.score).toBeGreaterThanOrEqual(60);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Scenario 6: Full Pipeline Happy Path — vibe to verify, no breaks
// ─────────────────────────────────────────────────────────────────────
describe("Scenario 6: Full Pipeline Happy Path", () => {
  it("runs vibe → contract → plan → converge → verify without breaking", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-s6-"));
    await initGitRepo(root);
    await seedRepo(root, { "src/index.ts": "export const ok = true;\n" });
    const paths = await ensureSalaciaDirs(root);

    // 1. Vibe → Contract
    const contract = createContractFromVibe("add user authentication", "happy-repo");
    contract.verification.commands = ['node -e "process.exit(0)"'];
    contract.plan.steps = [
      {
        id: "add-auth-module",
        riskLevel: "low",
        expectedArtifacts: [],
        verification: ['node -e "process.exit(0)"']
      }
    ];
    const contractPath = path.join(paths.contracts, "happy.yaml");
    await saveContract(contract, contractPath);

    // 2. Contract → Plan
    const plan = derivePlan(contract);
    const planPath = path.join(paths.plans, "happy.json");
    await savePlan(plan, planPath);

    // Verify artifacts exist and are valid
    const loadedContract = await fs.readFile(contractPath, "utf8");
    const loadedPlan = JSON.parse(await fs.readFile(planPath, "utf8"));
    expect(loadedContract).toContain("add user authentication");
    expect(loadedPlan.contractId).toBe(contract.identity.id);
    expect(loadedPlan.steps.length).toBeGreaterThan(0);

    // 3. Converge(plan) — local only, no external LLM needed
    const planOpinions: AdvisorOpinion[] = [
      { advisor: "claude", vote: "approve", summary: "Plan is sound", parseStatus: "ok", evidenceRef: "c.json" },
      { advisor: "gemini", vote: "approve", summary: "LGTM", parseStatus: "ok", evidenceRef: "g.json" },
      { advisor: "codex", vote: "approve", summary: "OK", parseStatus: "ok" }
    ];
    const planDecision = resolveConvergence("plan", planOpinions);
    expect(planDecision.winner).toBe("approve");

    // 4. Verify
    const verification = await runVerification(contract, root);
    expect(verification.success).toBe(true);

    // 5. Converge(exec)
    const execOpinions: AdvisorOpinion[] = [
      { advisor: "claude", vote: "approve", summary: "Verified", parseStatus: "ok", evidenceRef: "c.json" },
      { advisor: "gemini", vote: "approve", summary: "Good", parseStatus: "ok", evidenceRef: "g.json" },
      { advisor: "codex", vote: "approve", summary: "Pass", parseStatus: "ok" }
    ];
    const execDecision = resolveConvergence("exec", execOpinions);
    expect(execDecision.winner).toBe("approve");

    // 6. Consistency check — clean state
    const consistency = await evaluateConsistency(contract, plan, root);
    expect(consistency.ok).toBe(true);
    expect(consistency.violations.length).toBe(0);
  });
});
