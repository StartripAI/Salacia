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
import { copyRealAdvisorScripts, ensureRealLlmEnvironment } from "./helpers/real-e2e.js";

async function runConvergenceUntilApprove(
  run: () => Promise<Awaited<ReturnType<typeof runConvergence>>>,
  attempts = 2
): Promise<Awaited<ReturnType<typeof runConvergence>>> {
  let last: Awaited<ReturnType<typeof runConvergence>> | null = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    last = await run();
    if (last.winner === "approve") {
      return last;
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  if (!last) {
    throw new Error("Convergence did not produce a decision");
  }
  return last;
}

describe("end-to-end flow", () => {
  it("runs plan -> converge(plan) -> execute -> verify -> converge(exec)", async () => {
    await ensureRealLlmEnvironment();

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-e2e-"));
    const paths = await ensureSalaciaDirs(root);

    await copyRealAdvisorScripts(process.cwd(), root);

    const contractPath = path.join(paths.contracts, "e2e.yaml");
    const planPath = path.join(paths.plans, "e2e.json");
    const verifyCmd = `node -e "const fs=require('fs');const files=['${contractPath}','${planPath}'];for(const p of files){if(!fs.existsSync(p)){process.exit(1);}}process.exit(0);"`;

    const contract = createContractFromVibe("build a todo app", "e2e-repo");
    contract.plan.steps = [
      {
        id: "validate-planning-artifacts",
        riskLevel: "low",
        expectedArtifacts: [contractPath, planPath],
        verification: [verifyCmd]
      }
    ];
    contract.verification.commands = [verifyCmd];
    await saveContract(contract, contractPath);

    const plan = derivePlan(contract);
    await savePlan(plan, planPath);

    const initResult = await runHarnessInitializer(plan, root);
    expect(initResult.featureCount).toBe(plan.steps.length);

    const planDecision = await runConvergenceUntilApprove(() =>
      runConvergence({
        stage: "plan",
        inputPath: planPath,
        external: true,
        strictExternal: true,
        timeoutMs: 30_000,
        retries: 0,
        cwd: root
      })
    );
    expect(planDecision.winner).toBe("approve");
    const planExternalOk = planDecision.advisors.filter(
      (item) =>
        item.advisor !== "codex" &&
        item.parseStatus === "ok" &&
        item.vote !== "abstain" &&
        Boolean((item.evidenceRef ?? "").length > 0)
    );
    expect(planExternalOk.length).toBeGreaterThan(0);

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

    const execDecision = await runConvergenceUntilApprove(() =>
      runConvergence({
        stage: "exec",
        inputPath: execEvidencePath,
        external: true,
        strictExternal: true,
        timeoutMs: 30_000,
        retries: 0,
        cwd: root
      })
    );

    expect(execDecision.winner).toBe("approve");
    const execExternalOk = execDecision.advisors.filter(
      (item) =>
        item.advisor !== "codex" &&
        item.parseStatus === "ok" &&
        item.vote !== "abstain" &&
        Boolean((item.evidenceRef ?? "").length > 0)
    );
    expect(execExternalOk.length).toBeGreaterThan(0);
  }, 300_000);
});
