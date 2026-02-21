import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VSCodeAdapter } from "../src/adapters/vscode.js";
import { createContractFromVibe, saveContract } from "../src/core/contract.js";
import { runConvergence } from "../src/core/converge.js";
import { ensureSalaciaDirs } from "../src/core/paths.js";
import { derivePlan, savePlan } from "../src/core/plan.js";
import { runHarnessInitializer } from "../src/harness/initializer.js";
import { runIncrementalExecution } from "../src/harness/incremental.js";
import { runVerification } from "../src/guardian/verify.js";

async function writeMockAdvisor(scriptPath: string): Promise<void> {
  await fs.mkdir(path.dirname(scriptPath), { recursive: true });
  await fs.writeFile(
    scriptPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "echo '{\"vote\":\"approve\",\"summary\":\"mock approve\",\"evidenceRef\":\"mock-evidence\"}'"
    ].join("\n"),
    "utf8"
  );
  await fs.chmod(scriptPath, 0o755);
}

describe("end-to-end flow", () => {
  it("runs plan -> converge(plan) -> execute -> verify -> converge(exec)", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-e2e-"));
    const paths = await ensureSalaciaDirs(root);

    await writeMockAdvisor(path.join(root, "scripts", "validate-claude.sh"));
    await writeMockAdvisor(path.join(root, "scripts", "validate-gemini.sh"));

    const contract = createContractFromVibe("build a todo app", "e2e-repo");
    contract.plan.steps = contract.plan.steps.map((step) => ({
      ...step,
      verification: ["node -e \"process.exit(0)\""]
    }));
    contract.verification.commands = ["node -e \"process.exit(0)\""];

    const contractPath = path.join(paths.contracts, "e2e.yaml");
    await saveContract(contract, contractPath);

    const plan = derivePlan(contract);
    const planPath = path.join(paths.plans, "e2e.json");
    await savePlan(plan, planPath);

    const initResult = await runHarnessInitializer(plan, root);
    expect(initResult.featureCount).toBe(plan.steps.length);

    const planDecision = await runConvergence({
      stage: "plan",
      inputPath: planPath,
      external: true,
      cwd: root
    });
    expect(planDecision.winner).toBe("approve");

    const adapter = new VSCodeAdapter();
    const summary = await runIncrementalExecution(adapter, plan, {
      cwd: root,
      mode: "auto",
      dryRun: true,
      stage: "exec"
    });
    expect(summary.failed).toBe(0);
    expect(summary.completed).toBe(plan.steps.length);

    const verification = await runVerification(contract, root);
    expect(verification.success).toBe(true);

    const execEvidencePath = path.join(paths.journal, "exec-evidence-e2e.json");
    await fs.writeFile(
      execEvidencePath,
      JSON.stringify(
        {
          success: true,
          verification: {
            success: verification.success
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const execDecision = await runConvergence({
      stage: "exec",
      inputPath: execEvidencePath,
      external: true,
      cwd: root
    });

    expect(execDecision.winner).toBe("approve");
  });
});
