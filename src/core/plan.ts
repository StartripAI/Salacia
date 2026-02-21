import fs from "node:fs/promises";
import path from "node:path";
import type { Contract, IntentIR, Plan, PlanStep } from "./types.js";

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

function stableStepId(index: number, criterion: string): string {
  const slug = criterion
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return slug ? `${index + 1}-${slug}` : `step-${index + 1}`;
}

export function derivePlanFromIntent(contract: Contract, intent: IntentIR): Plan {
  const criteria = intent.acceptanceCriteria.length > 0 ? intent.acceptanceCriteria : contract.intent.goals;
  const steps: PlanStep[] = criteria.map((criterion, index) => ({
    id: stableStepId(index, criterion),
    riskLevel: intent.risk.level === "critical" ? "high" : intent.risk.level,
    expectedArtifacts: contract.plan.steps[index]?.expectedArtifacts ?? [`.salacia/journal/${index + 1}.json`],
    verification: contract.plan.steps[index]?.verification ?? contract.verification.commands
  }));

  return {
    contractId: contract.identity.id,
    generatedAt: new Date().toISOString(),
    summary: intent.goals.join("; "),
    steps: steps.length > 0 ? steps : derivePlan(contract).steps
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
