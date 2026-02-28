import type { ExecutorAdapter } from "../adapters/base.js";
import type { Contract, ExecuteOptions, Plan, PlanStep } from "../core/types.js";
import { runIncrementalExecution, type IncrementalExecutionSummary } from "./incremental.js";
import { createRoleWorktree, createWorktreeRunId, removeRoleWorktree } from "./worktree.js";

const DEFAULT_ROLES = ["reviewer", "verifier"];

function normalizeRoles(input?: string[]): string[] {
  if (!Array.isArray(input) || input.length === 0) {
    return [...DEFAULT_ROLES];
  }

  const seen = new Set<string>();
  const roles: string[] = [];
  for (const item of input) {
    const normalized = String(item || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-");
    if (!normalized || normalized === "orchestrator" || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    roles.push(normalized);
  }

  return roles.length > 0 ? roles : [...DEFAULT_ROLES];
}

function normalizeFanout(input?: number): number {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    return 2;
  }
  const value = Math.trunc(input);
  if (value < 1) return 1;
  if (value > 8) return 8;
  return value;
}

function createRoleStepPlan(plan: Plan, step: PlanStep, role: string): Plan {
  return {
    ...plan,
    summary: `[${role}] ${plan.summary}`,
    steps: [step]
  };
}

async function runWithFanout<T>(tasks: Array<() => Promise<T>>, fanout: number): Promise<T[]> {
  const results: T[] = [];
  const width = normalizeFanout(fanout);
  for (let index = 0; index < tasks.length; index += width) {
    const batch = tasks.slice(index, index + width);
    const batchResults = await Promise.all(batch.map((task) => task()));
    results.push(...batchResults);
  }
  return results;
}

export interface MultiAgentRoleRun {
  role: string;
  stepId: string;
  success: boolean;
  output: string;
  cwd: string;
  startedAt: string;
  finishedAt: string;
  worktreeCreated: boolean;
  worktreeFallback: boolean;
  worktreeReason: string | null;
  cleanupOk: boolean;
  cleanupError?: string;
}

export interface MultiAgentExecutionSummary {
  topology: "multi";
  runId: string;
  roles: string[];
  fanout: number;
  orchestrator: IncrementalExecutionSummary;
  roleRuns: MultiAgentRoleRun[];
  roleSummary: {
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
  };
  worktrees: {
    created: number;
    fallback: number;
    cleanupFailed: number;
  };
  mergePolicy: {
    policy: "deterministic-majority-v1";
    conflictCount: number;
    requiresHumanGate: boolean;
    conflicts: Array<{
      stepId: string;
      reason: string;
      roles: string[];
      outputs: number;
    }>;
  };
}

export interface MultiAgentExecutionOptions extends ExecuteOptions {
  roles?: string[];
  fanout?: number;
}

export async function runMultiAgentExecution(
  adapter: ExecutorAdapter,
  plan: Plan,
  options: MultiAgentExecutionOptions,
  contract?: Contract
): Promise<MultiAgentExecutionSummary> {
  const roles = normalizeRoles(options.roles);
  const fanout = normalizeFanout(options.fanout);
  const runId = createWorktreeRunId();

  const orchestrator = await runIncrementalExecution(
    adapter,
    plan,
    {
      ...options,
      cwd: options.cwd
    },
    contract
  );

  const completedSteps = plan.steps.slice(0, orchestrator.completed);
  const tasks: Array<() => Promise<MultiAgentRoleRun>> = [];

  for (const step of completedSteps) {
    for (const role of roles) {
      tasks.push(async () => {
        const startedAt = new Date().toISOString();
        const session = await createRoleWorktree(options.cwd, role, runId, step.id);
        let success = false;
        let output = "";

        try {
          const rolePlan = createRoleStepPlan(plan, step, role);
          const result = await adapter.execute(rolePlan, {
            ...options,
            cwd: session.path,
            dryRun: true
          });
          success = result.success;
          output = result.output;
        } catch (error) {
          success = false;
          output = (error as Error).message;
        }

        const cleanup = await removeRoleWorktree(options.cwd, session);

        const run: MultiAgentRoleRun = {
          role,
          stepId: step.id,
          success,
          output,
          cwd: session.path,
          startedAt,
          finishedAt: new Date().toISOString(),
          worktreeCreated: session.created,
          worktreeFallback: session.fallback,
          worktreeReason: session.reason,
          cleanupOk: cleanup.ok
        };
        if (!cleanup.ok && cleanup.error) {
          run.cleanupError = cleanup.error;
        }
        return run;
      });
    }
  }

  const roleRuns = await runWithFanout(tasks, fanout);
  const successfulRuns = roleRuns.filter((run) => run.success).length;
  const conflicts = [];
  const runsByStep = new Map<string, MultiAgentRoleRun[]>();
  for (const run of roleRuns) {
    const bucket = runsByStep.get(run.stepId) ?? [];
    bucket.push(run);
    runsByStep.set(run.stepId, bucket);
  }
  for (const [stepId, stepRuns] of runsByStep) {
    if (stepRuns.length <= 1) continue;
    const successVotes = new Set(stepRuns.map((item) => item.success));
    const outputVariants = new Set(
      stepRuns.map((item) =>
        String(item.output || "")
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 300)
      )
    );
    if (successVotes.size > 1 || outputVariants.size > 1) {
      conflicts.push({
        stepId,
        reason: successVotes.size > 1 ? "success-vote-divergence" : "output-divergence",
        roles: stepRuns.map((item) => item.role),
        outputs: outputVariants.size
      });
    }
  }

  return {
    topology: "multi",
    runId,
    roles,
    fanout,
    orchestrator,
    roleRuns,
    roleSummary: {
      totalRuns: roleRuns.length,
      successfulRuns,
      failedRuns: roleRuns.length - successfulRuns
    },
    worktrees: {
      created: roleRuns.filter((run) => run.worktreeCreated).length,
      fallback: roleRuns.filter((run) => run.worktreeFallback).length,
      cleanupFailed: roleRuns.filter((run) => !run.cleanupOk).length
    },
    mergePolicy: {
      policy: "deterministic-majority-v1",
      conflictCount: conflicts.length,
      requiresHumanGate: conflicts.length > 0,
      conflicts
    }
  };
}
