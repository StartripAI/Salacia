import type { ExecutorAdapter } from "../adapters/base.js";
import type { Contract, ExecuteOptions, Plan } from "../core/types.js";
import { evaluateConsistency } from "../guardian/consistency.js";
import { ProgressTracker } from "../guardian/progress.js";
import { runVerificationCommands } from "../guardian/verify.js";

export interface IncrementalExecutionSummary {
  completed: number;
  failed: number;
  outputs: string[];
  stepVerifications: Array<{
    stepId: string;
    success: boolean;
    evidencePath?: string;
  }>;
  consistencyReports: Array<{
    phase: string;
    ok: boolean;
    score: number;
    violations: number;
    snapshotId?: string;
  }>;
}

export async function runIncrementalExecution(
  adapter: ExecutorAdapter,
  plan: Plan,
  options: ExecuteOptions,
  contract?: Contract
): Promise<IncrementalExecutionSummary> {
  const tracker = new ProgressTracker(options.cwd);
  await tracker.initializeFromPlan(plan);

  let completed = 0;
  let failed = 0;
  const outputs: string[] = [];
  const stepVerifications: IncrementalExecutionSummary["stepVerifications"] = [];
  const consistencyReports: IncrementalExecutionSummary["consistencyReports"] = [];

  if (contract) {
    const preReport = await evaluateConsistency(contract, plan, options.cwd, {
      autoSnapshotOnHighRisk: true
    });
    consistencyReports.push({
      phase: "pre-exec",
      ok: preReport.ok,
      score: preReport.score,
      violations: preReport.violations.length,
      ...(preReport.snapshotId ? { snapshotId: preReport.snapshotId } : {})
    });

    if (!preReport.ok) {
      failed += 1;
      outputs.push(preReport.suggestion ?? "Execution blocked by consistency guardian.");
      return { completed, failed, outputs, stepVerifications, consistencyReports };
    }
  }

  for (const step of plan.steps) {
    await tracker.updateStep(step.id, "doing", false);

    const singleStepPlan: Plan = {
      ...plan,
      steps: [step],
      summary: `Incremental step ${step.id}`
    };

    const result = await adapter.execute(singleStepPlan, options);
    outputs.push(result.output);

    if (result.success) {
      const verify = await runVerificationCommands(plan.contractId, step.verification, options.cwd, {
        stage: "step",
        persistEvidence: true
      });
      stepVerifications.push({
        stepId: step.id,
        success: verify.success,
        ...(verify.evidencePath ? { evidencePath: verify.evidencePath } : {})
      });
      if (!verify.success) {
        failed += 1;
        await tracker.updateStep(step.id, "failed", false);
        break;
      }

      completed += 1;
      await tracker.updateStep(step.id, "done", true);

      if (contract) {
        const postReport = await evaluateConsistency(contract, plan, options.cwd, {
          autoSnapshotOnHighRisk: true
        });
        consistencyReports.push({
          phase: `post-${step.id}`,
          ok: postReport.ok,
          score: postReport.score,
          violations: postReport.violations.length,
          ...(postReport.snapshotId ? { snapshotId: postReport.snapshotId } : {})
        });
        if (!postReport.ok) {
          failed += 1;
          await tracker.updateStep(step.id, "failed", false);
          outputs.push(postReport.suggestion ?? "Execution blocked by consistency guardian.");
          break;
        }
      }
    } else {
      failed += 1;
      await tracker.updateStep(step.id, "failed", false);
      break;
    }
  }

  return { completed, failed, outputs, stepVerifications, consistencyReports };
}
