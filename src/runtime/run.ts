import fs from "node:fs/promises";
import path from "node:path";
import { findAdapter } from "../adapters/registry.js";
import type { ExecutorAdapter } from "../adapters/base.js";
import type {
  Blueprint,
  JudgeReport,
  Plan,
  RunEvent,
  RunSessionSummary
} from "../core/types.js";
import { createRunId, ensureRunDirs, getRunPaths, resolveLatestRunId } from "../core/paths.js";
import { runVerificationCommands } from "../guardian/verify.js";
import { RollbackEngine } from "../guardian/rollback.js";
import { SnapshotManager } from "../guardian/snapshot.js";
import { buildContextPack, saveContextPack } from "../context/pack.js";
import { appendRunEvent, loadJudgeReport, loadRunEvents, loadRunSummary, saveJudgeReport, saveRunSummary } from "../harness/run-session.js";
import { applyCandidatePatch, collectChangedFiles, judgeRun, writeCandidatePatch } from "../harness/judge.js";
import { createRoleWorktree, createWorktreeRunId, removeRoleWorktree } from "../harness/worktree.js";

function createPlanFromBlueprint(blueprint: Blueprint): Plan {
  return {
    contractId: blueprint.id,
    generatedAt: blueprint.generatedAt,
    summary: blueprint.goal,
    steps: [
      {
        id: "program-run",
        riskLevel: "medium",
        expectedArtifacts: [...blueprint.mutableSurface],
        verification: [...blueprint.verificationCommands]
      }
    ]
  };
}

async function resolvePreferredAdapter(name?: string): Promise<ExecutorAdapter> {
  if (name) {
    const adapter = findAdapter(name);
    if (!adapter) {
      throw new Error(`Adapter not found: ${name}`);
    }
    return adapter;
  }

  const preference = ["codex", "claude-code", "opencode", "vscode", "cursor", "cline", "antigravity"];
  for (const target of preference) {
    const adapter = findAdapter(target);
    if (!adapter) continue;
    if (await adapter.isAvailable()) {
      return adapter;
    }
  }

  throw new Error("No adapter route available. Install/configure one or pass --adapter.");
}

async function emitEvent(root: string, runId: string, type: RunEvent["type"], data: Record<string, unknown>): Promise<void> {
  await appendRunEvent(root, runId, {
    type,
    timestamp: new Date().toISOString(),
    data
  });
}

export interface RuntimeRunOptions {
  root: string;
  blueprint: Blueprint;
  adapterName?: string | undefined;
  dryRun?: boolean;
  mode?: "auto" | "cli";
}

export async function runBlueprint(options: RuntimeRunOptions): Promise<{
  runId: string;
  summary: RunSessionSummary;
  judge: JudgeReport;
}> {
  const root = options.root;
  const runId = createRunId();
  const run = await ensureRunDirs(root, runId);
  const startedAt = new Date().toISOString();
  const adapter = await resolvePreferredAdapter(options.adapterName);
  const plan = createPlanFromBlueprint(options.blueprint);

  await emitEvent(root, runId, "compile_program", {
    blueprintId: options.blueprint.id,
    programPath: options.blueprint.programPath
  });
  await fs.writeFile(run.blueprint, JSON.stringify(options.blueprint, null, 2), "utf8");

  const contextPack = await buildContextPack(root, options.blueprint);
  const contextPath = await saveContextPack(root, runId, contextPack);
  await emitEvent(root, runId, "build_context", {
    contextPath,
    repoMapFiles: contextPack.repoMap.topFiles.length,
    workingSetFiles: contextPack.workingSet.relevantFiles.length
  });

  const worktreeRunId = createWorktreeRunId();
  const worktree = await createRoleWorktree(root, "harness", worktreeRunId, "run");
  const workspacePath = worktree.path;
  const workspaceMode = worktree.created ? "worktree" : "root";

  let snapshotId: string | null = null;
  if (!worktree.created) {
    try {
      const snapshot = await new SnapshotManager(root).createSnapshot(`run-${runId}`);
      snapshotId = snapshot.id;
    } catch {
      snapshotId = null;
    }
  }

  await emitEvent(root, runId, "prepare_workspace", {
    workspacePath,
    workspaceMode,
    snapshotId
  });

  const execution = await adapter.execute(plan, {
    cwd: workspacePath,
    dryRun: Boolean(options.dryRun),
    stage: "exec",
    mode: options.mode ?? "auto"
  });
  await emitEvent(root, runId, "dispatch_agent", {
    adapter: adapter.name,
    success: execution.success,
    artifactCount: execution.artifacts.length
  });

  const changedFiles = await collectChangedFiles(workspacePath);
  const candidatePatchPath = await writeCandidatePatch(workspacePath, run.candidatePatch);
  await emitEvent(root, runId, "collect_patch", {
    changedFiles,
    candidatePatchPath
  });

  const verification = await runVerificationCommands(options.blueprint.id, options.blueprint.verificationCommands, workspacePath, {
    stage: "full",
    persistEvidence: true
  });
  await emitEvent(root, runId, "run_verification", {
    success: verification.success,
    evidencePath: verification.evidencePath ?? null
  });

  const judge = await judgeRun({
    runId,
    blueprint: options.blueprint,
    adapter: adapter.name,
    workspaceMode,
    programPath: options.blueprint.programPath,
    contextPath,
    changedFiles,
    verification,
    executionSuccess: execution.success,
    evidenceRefs: [
      contextPath,
      ...(verification.evidencePath ? [verification.evidencePath] : []),
      ...(candidatePatchPath ? [candidatePatchPath] : []),
      ...execution.artifacts
    ]
  });
  judge.contextEvidence.repoMapFiles = contextPack.repoMap.topFiles.map((file) => file.path);
  judge.contextEvidence.workingSetFiles = contextPack.workingSet.relevantFiles.map((file) => file.path);
  judge.contextEvidence.historyEntries = contextPack.runHistory.length;
  await saveJudgeReport(root, runId, judge);
  await emitEvent(root, runId, "run_judge", {
    judgeDecision: judge.judgeDecision,
    promotionDecision: judge.promotionDecision,
    score: judge.score
  });

  let status: RunSessionSummary["status"] = "failed";
  if (judge.promotionDecision === "accept") {
    if (worktree.created && candidatePatchPath) {
      const applied = await applyCandidatePatch(root, candidatePatchPath);
      if (!applied.ok) {
        judge.promotionDecision = "blocked";
        judge.judgeDecision = "blocked";
        judge.issues.push({
          code: "out-of-scope-write",
          message: `Promotion blocked: ${applied.error ?? "candidate patch could not be applied"}`
        });
        await saveJudgeReport(root, runId, judge);
      }
    }
  }

  if (!worktree.created && snapshotId && judge.promotionDecision !== "accept") {
    await new RollbackEngine(new SnapshotManager(root)).rollback(snapshotId, {
      retries: 0,
      cwd: root
    }).catch(() => undefined);
  }

  if (worktree.created) {
    await removeRoleWorktree(root, worktree).catch(() => undefined);
  }

  if (judge.promotionDecision === "accept") status = "accepted";
  else if (judge.promotionDecision === "reject") status = "rejected";
  else if (judge.promotionDecision === "blocked") status = "blocked";

  await emitEvent(root, runId, "promote_or_revert", {
    promotionDecision: judge.promotionDecision,
    status
  });

  const summary: RunSessionSummary = {
    runId,
    blueprintId: options.blueprint.id,
    programPath: options.blueprint.programPath,
    adapter: adapter.name,
    workspacePath,
    workspaceMode,
    startedAt,
    finishedAt: new Date().toISOString(),
    status,
    changedFiles,
    execution: {
      success: execution.success,
      output: execution.output,
      artifacts: execution.artifacts
    },
    verification,
    judge,
    promotionDecision: judge.promotionDecision,
    contextPath,
    candidatePatchPath,
    evidenceRefs: Array.from(
      new Set([
        run.summary,
        run.judge,
        contextPath,
        ...(candidatePatchPath ? [candidatePatchPath] : []),
        ...(verification.evidencePath ? [verification.evidencePath] : []),
        ...execution.artifacts
      ])
    )
  };
  await saveRunSummary(root, runId, summary);
  await emitEvent(root, runId, "finalize_session", {
    summaryPath: run.summary,
    judgePath: run.judge,
    status
  });

  return { runId, summary, judge };
}

export async function resolveTrace(root: string, runId?: string): Promise<{
  runId: string;
  summary: RunSessionSummary;
  judge: JudgeReport | null;
  events: RunEvent[];
}> {
  const targetRunId = runId ?? (await resolveLatestRunId(root));
  if (!targetRunId) {
    throw new Error("No run found.");
  }
  const summary = await loadRunSummary(root, targetRunId);
  if (!summary) {
    throw new Error(`Run summary not found for ${targetRunId}`);
  }
  return {
    runId: targetRunId,
    summary,
    judge: await loadJudgeReport(root, targetRunId),
    events: await loadRunEvents(root, targetRunId)
  };
}
