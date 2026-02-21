import type { ExecutorAdapter } from "../adapters/base.js";
import type { ExecuteOptions, Plan } from "../core/types.js";
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
}

export async function runIncrementalExecution(
  adapter: ExecutorAdapter,
  plan: Plan,
  options: ExecuteOptions
): Promise<IncrementalExecutionSummary> {
  const tracker = new ProgressTracker(options.cwd);
  await tracker.initializeFromPlan(plan);

  let completed = 0;
  let failed = 0;
  const outputs: string[] = [];
  const stepVerifications: IncrementalExecutionSummary["stepVerifications"] = [];

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
    } else {
      failed += 1;
      await tracker.updateStep(step.id, "failed", false);
      break;
    }
  }

  return { completed, failed, outputs, stepVerifications };
}
