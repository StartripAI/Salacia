import path from "node:path";
import fs from "node:fs/promises";
import { createContractFromIntentIR, validateContract } from "./contract.js";
import { ensureSalaciaDirs } from "./paths.js";
import { derivePlanFromIntent, savePlan } from "./plan.js";
import { generateSpecMarkdown, saveSpec } from "./spec.js";
import { initRepository } from "./init.js";
import { runVibeForge } from "./vibeforge.js";
import { detectAdapter, detectProject } from "./auto-detect.js";
import { loadHarnessConfig } from "./install.js";
import {
  startSession,
  updateSession,
  finishSession
} from "./memory.js";
import { SnapshotManager } from "../guardian/snapshot.js";
import { RollbackEngine } from "../guardian/rollback.js";
import { runIncrementalExecution } from "../harness/incremental.js";
import { runVerification } from "../guardian/verify.js";
import { runHarnessInitializer } from "../harness/initializer.js";
import type { Contract, Plan } from "./types.js";

// ── Types ───────────────────────────────────────────────────────────

export type RunStage =
  | "init"
  | "detect"
  | "plan"
  | "snapshot"
  | "execute"
  | "verify"
  | "memory"
  | "done"
  | "rollback"
  | "error";

export interface RunStageResult {
  stage: RunStage;
  ok: boolean;
  detail: string;
  durationMs: number;
}

export interface RunDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  suggestion: string;
}

export interface RunOptions {
  cwd?: string | undefined;
  adapter?: string | undefined;
  dryRun?: boolean | undefined;
  topology?: "single" | "multi" | undefined;
  rollback?: boolean | undefined;
  verbose?: boolean | undefined;
  onProgress?: ((stage: RunStage, detail: string) => void) | undefined;
}

export interface RunResult {
  ok: boolean;
  stages: RunStageResult[];
  adapter: string;
  stepsCompleted: number;
  stepsTotal: number;
  diagnostics: RunDiagnostic[];
  error?: string | undefined;
  verificationPassed?: boolean | undefined;
  rolledBack?: boolean | undefined;
  planPath?: string | undefined;
  contractPath?: string | undefined;
}

// ── Helpers ─────────────────────────────────────────────────────────

function elapsed(start: number): number {
  return Date.now() - start;
}

function stageOk(stage: RunStage, detail: string, startMs: number): RunStageResult {
  return { stage, ok: true, detail, durationMs: elapsed(startMs) };
}

function stageFail(stage: RunStage, detail: string, startMs: number): RunStageResult {
  return { stage, ok: false, detail, durationMs: elapsed(startMs) };
}

// ── Main Run Function ───────────────────────────────────────────────

export async function run(vibe: string, options?: RunOptions): Promise<RunResult> {
  const cwd = options?.cwd ?? process.cwd();
  const rollbackEnabled = options?.rollback ?? true;
  const dryRun = options?.dryRun ?? false;
  const progress = options?.onProgress ?? (() => {});

  const stages: RunStageResult[] = [];
  const diagnostics: RunDiagnostic[] = [];
  let adapterName = options?.adapter ?? "auto";
  let snapshotId: string | null = null;
  let contract: Contract | null = null;
  let plan: Plan | null = null;
  let planPath: string | undefined;
  let contractPath: string | undefined;

  // ── Stage: Init ─────────────────────────────────────────────────
  const initStart = Date.now();
  progress("init", "Initializing harness environment...");
  try {
    const salaciaDir = path.join(cwd, ".salacia");
    const exists = await fs.access(salaciaDir).then(() => true).catch(() => false);
    if (!exists) {
      await initRepository(cwd);
    }
    await ensureSalaciaDirs(cwd);
    stages.push(stageOk("init", exists ? "Harness already initialized" : "Harness initialized", initStart));
  } catch (err) {
    stages.push(stageFail("init", (err as Error).message, initStart));
    return { ok: false, stages, adapter: adapterName, stepsCompleted: 0, stepsTotal: 0, diagnostics, error: (err as Error).message };
  }

  // ── Stage: Detect ───────────────────────────────────────────────
  const detectStart = Date.now();
  progress("detect", "Detecting AI agent and project environment...");
  try {
    const config = await loadHarnessConfig(cwd);
    const configPreference = adapterName !== "auto" ? adapterName : config?.harness?.adapter;

    const detection = await detectAdapter(configPreference);
    adapterName = detection.adapter.name;

    const project = await detectProject(cwd);
    if (project.testCommands.length === 0) {
      diagnostics.push({
        code: "no-verification",
        severity: "warning",
        message: "No test command detected for this project.",
        suggestion: "Add a test script to package.json or equivalent for full self-verification."
      });
    }

    stages.push(stageOk("detect", `Adapter: ${adapterName}, Project: ${project.type}`, detectStart));
  } catch (err) {
    stages.push(stageFail("detect", (err as Error).message, detectStart));
    diagnostics.push({
      code: "no-adapter-found",
      severity: "error",
      message: (err as Error).message,
      suggestion: "Install an AI coding agent: npm i -g @anthropic-ai/claude-code"
    });
    return { ok: false, stages, adapter: adapterName, stepsCompleted: 0, stepsTotal: 0, diagnostics, error: (err as Error).message };
  }

  // ── Stage: Plan ─────────────────────────────────────────────────
  const planStart = Date.now();
  progress("plan", "Generating contract and execution plan...");
  try {
    const forge = await runVibeForge(vibe, {
      cwd,
      autoAnswerWithRecommended: true
    });

    if (!forge.ok || !forge.intent) {
      const msg = forge.code === "disambiguation-required"
        ? "Vibe requires clarification. Please be more specific."
        : "Prompt compilation failed metamorphic tests.";
      stages.push(stageFail("plan", msg, planStart));
      diagnostics.push({
        code: `plan-${forge.code}`,
        severity: "error",
        message: msg,
        suggestion: "Try a more specific prompt, e.g.: 'add JWT authentication to the Express API'"
      });
      return { ok: false, stages, adapter: adapterName, stepsCompleted: 0, stepsTotal: 0, diagnostics, error: msg };
    }

    contract = createContractFromIntentIR(forge.intent);
    const valid = validateContract(contract);
    if (!valid.valid) {
      stages.push(stageFail("plan", `Contract validation failed: ${valid.errors.join(", ")}`, planStart));
      return {
        ok: false, stages, adapter: adapterName, stepsCompleted: 0, stepsTotal: 0, diagnostics,
        error: `Contract validation failed: ${valid.errors.join(", ")}`
      };
    }

    const paths = await ensureSalaciaDirs(cwd);
    const ts = Date.now();

    contractPath = path.join(paths.contracts, `${ts}.yaml`);
    const { saveContract } = await import("./contract.js");
    await saveContract(contract, contractPath!);

    plan = derivePlanFromIntent(contract, forge.intent);
    planPath = path.join(paths.plans, `${ts}.json`);
    await savePlan(plan, planPath!);

    const spec = generateSpecMarkdown(contract, plan);
    await saveSpec(spec, path.join(paths.specs, `${ts}.md`));

    await runHarnessInitializer(plan, cwd);
    stages.push(stageOk("plan", `${plan.steps.length} steps planned`, planStart));
  } catch (err) {
    stages.push(stageFail("plan", (err as Error).message, planStart));
    return { ok: false, stages, adapter: adapterName, stepsCompleted: 0, stepsTotal: 0, diagnostics, error: (err as Error).message };
  }

  // ── Stage: Snapshot ─────────────────────────────────────────────
  if (rollbackEnabled) {
    const snapStart = Date.now();
    progress("snapshot", "Creating safety snapshot...");
    try {
      const manager = new SnapshotManager(cwd);
      const snapshot = await manager.createSnapshot("pre-run");
      snapshotId = snapshot.id;
      stages.push(stageOk("snapshot", `Snapshot ${snapshotId}`, snapStart));
    } catch (err) {
      stages.push(stageFail("snapshot", (err as Error).message, snapStart));
      diagnostics.push({
        code: "snapshot-failed",
        severity: "warning",
        message: "Could not create safety snapshot. Rollback will not be available.",
        suggestion: "Ensure you are inside a git repository with at least one commit."
      });
    }
  }

  // ── Stage: Execute ──────────────────────────────────────────────
  const execStart = Date.now();
  progress("execute", `Executing ${plan!.steps.length} steps with ${adapterName}...`);

  await startSession(cwd, vibe, adapterName, plan!.steps.length);

  let stepsCompleted = 0;
  let executionFailed = false;

  try {
    const { findAdapter } = await import("../adapters/registry.js");
    const adapter = findAdapter(adapterName);
    if (!adapter) {
      throw new Error(`Adapter not found: ${adapterName}`);
    }

    const summary = await runIncrementalExecution(
      adapter,
      plan!,
      {
        cwd,
        dryRun,
        stage: "exec",
        mode: "auto"
      },
      contract!
    );

    stepsCompleted = summary.completed;
    executionFailed = summary.failed > 0;

    await updateSession(cwd, { stepsCompleted, lastOutput: summary.outputs[summary.outputs.length - 1] ?? "" });

    if (executionFailed) {
      stages.push(stageFail("execute", `${summary.completed}/${plan!.steps.length} steps, ${summary.failed} failed`, execStart));
      diagnostics.push({
        code: "execution-failed",
        severity: "error",
        message: `Execution failed at step ${summary.completed + 1}/${plan!.steps.length}.`,
        suggestion: "Check the step output above for details. You may need to adjust your prompt."
      });
    } else {
      stages.push(stageOk("execute", `${summary.completed}/${plan!.steps.length} steps completed`, execStart));
    }
  } catch (err) {
    executionFailed = true;
    stages.push(stageFail("execute", (err as Error).message, execStart));
    diagnostics.push({
      code: "execution-error",
      severity: "error",
      message: (err as Error).message,
      suggestion: "This may be an adapter-level error. Check if the AI agent CLI is working correctly."
    });
  }

  // ── Stage: Verify ───────────────────────────────────────────────
  let verificationPassed = false;
  if (!executionFailed && contract) {
    const verifyStart = Date.now();
    progress("verify", "Running verification...");
    try {
      const verification = await runVerification(contract, cwd);
      verificationPassed = verification.success;
      if (verificationPassed) {
        stages.push(stageOk("verify", "All verification checks passed", verifyStart));
      } else {
        stages.push(stageFail("verify", "Verification failed", verifyStart));
        diagnostics.push({
          code: "verification-failed",
          severity: "error",
          message: "Verification checks did not pass after execution.",
          suggestion: "Run your test suite manually to debug: " + (contract.verification.commands[0] ?? "npm test")
        });
      }
    } catch (err) {
      stages.push(stageFail("verify", (err as Error).message, verifyStart));
    }
  }

  // ── Stage: Rollback ─────────────────────────────────────────────
  let rolledBack = false;
  const shouldRollback = (executionFailed || !verificationPassed) && rollbackEnabled && snapshotId;
  if (shouldRollback) {
    const rollStart = Date.now();
    progress("rollback", "Rolling back to safe snapshot...");
    try {
      const manager = new SnapshotManager(cwd);
      const engine = new RollbackEngine(manager);
      await engine.rollback(snapshotId!);
      rolledBack = true;
      stages.push(stageOk("rollback", `Rolled back to snapshot ${snapshotId}`, rollStart));
      diagnostics.push({
        code: "rollback-success",
        severity: "info",
        message: "Changes rolled back. Workspace restored to pre-run state.",
        suggestion: "Try refining your prompt and run again."
      });
    } catch (err) {
      stages.push(stageFail("rollback", (err as Error).message, rollStart));
      diagnostics.push({
        code: "rollback-failed",
        severity: "error",
        message: `Rollback failed: ${(err as Error).message}`,
        suggestion: "Manual recovery may be needed. Check git log and git stash."
      });
    }
  }

  // ── Stage: Memory Update ────────────────────────────────────────
  const memStart = Date.now();
  progress("memory", "Updating session memory...");
  const finalStatus = executionFailed || !verificationPassed
    ? (rolledBack ? "rollback" : "fail")
    : "pass";
  await finishSession(cwd, finalStatus as "pass" | "fail" | "rollback");
  stages.push(stageOk("memory", "Session recorded", memStart));

  // ── Stage: Done ─────────────────────────────────────────────────
  const ok = !executionFailed && verificationPassed;
  progress("done", ok ? "All steps completed successfully!" : "Run finished with issues.");
  stages.push({
    stage: "done",
    ok,
    detail: ok
      ? `${stepsCompleted}/${plan!.steps.length} steps completed and verified`
      : `Completed with ${diagnostics.filter((d) => d.severity === "error").length} error(s)`,
    durationMs: 0
  });

  const errorMsg = diagnostics.find((d) => d.severity === "error")?.message;
  const result: RunResult = {
    ok,
    stages,
    adapter: adapterName,
    stepsCompleted,
    stepsTotal: plan!.steps.length,
    diagnostics,
    verificationPassed,
    rolledBack,
    planPath,
    contractPath
  };
  if (!ok && errorMsg) {
    result.error = errorMsg;
  }
  return result;
}
