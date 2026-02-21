import fs from "node:fs/promises";
import path from "node:path";
import type { Contract, Plan } from "./types.js";

export function generateSpecMarkdown(contract: Contract, plan: Plan): string {
  const steps = plan.steps
    .map(
      (step, idx) =>
        `${idx + 1}. **${step.id}** (${step.riskLevel})\\n   - Artifacts: ${step.expectedArtifacts.join(", "
        )}\\n   - Verify: ${step.verification.join(" && ")}`
    )
    .join("\n");

  return [
    `# Spec: ${contract.identity.id}`,
    "",
    "## Goal",
    contract.intent.goals.join("\n"),
    "",
    "## Constraints",
    contract.intent.constraints.map((c) => `- ${c}`).join("\n"),
    "",
    "## Scope",
    "### In Scope",
    contract.scope.inScope.map((s) => `- ${s}`).join("\n"),
    "",
    "### Out of Scope",
    contract.scope.outOfScope.map((s) => `- ${s}`).join("\n"),
    "",
    "## Plan",
    steps,
    "",
    "## Verification",
    contract.verification.commands.map((c) => `- \`${c}\``).join("\n"),
    "",
    "## Guardrails",
    contract.guardrails.invariants.map((g) => `- ${g}`).join("\n"),
    ""
  ].join("\n");
}

export async function saveSpec(markdown: string, filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, markdown, "utf8");
}
