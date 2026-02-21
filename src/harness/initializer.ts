import type { Plan } from "../core/types.js";
import { ProgressTracker } from "../guardian/progress.js";

export interface HarnessInitResult {
  progressFile: string;
  featureCount: number;
}

export async function runHarnessInitializer(plan: Plan, root = process.cwd()): Promise<HarnessInitResult> {
  const tracker = new ProgressTracker(root);
  const progress = await tracker.initializeFromPlan(plan);

  return {
    progressFile: tracker.progressFilePath,
    featureCount: progress.items.length
  };
}
