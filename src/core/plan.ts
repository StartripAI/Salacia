import fs from "node:fs/promises";
import path from "node:path";
import type { Contract, Plan, PlanStep } from "./types.js";

export function derivePlan(contract: Contract): Plan {
  const normalizedSteps: PlanStep[] = contract.plan.steps.map((step, index) => ({
    ...step,
    id: step.id || `step-${index + 1}`
  }));

  return {
    contractId: contract.identity.id,
    generatedAt: new Date().toISOString(),
    summary: contract.intent.goals.join("; "),
    steps: normalizedSteps
  };
}

export async function savePlan(plan: Plan, filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(plan, null, 2), "utf8");
}

export async function loadPlan(filePath: string): Promise<Plan> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as Plan;
}
