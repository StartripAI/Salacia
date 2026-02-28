import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import yaml from "js-yaml";
import { beforeAll, describe, expect, it } from "vitest";
import {
  copyRealAdvisorScripts,
  ensureRealLlmEnvironment,
  parseJsonOutput,
  runCli
} from "./helpers/real-e2e.js";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const CLI_PATH = path.join(ROOT, "dist", "cli", "index.js");

interface PlanPayload {
  ok: boolean;
  contractPath: string;
  planPath: string;
  specPath: string;
}

interface ExecutePayload {
  ok: boolean;
  execution: {
    executionPath: string;
    verifyPath: string;
    execEvidencePath: string;
  };
}

async function runCliUntilZero(
  label: string,
  fn: () => Promise<{ code: number; stdout: string; stderr: string }>,
  attempts = 2
): Promise<{ code: number; stdout: string; stderr: string }> {
  let last: { code: number; stdout: string; stderr: string } | null = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    last = await fn();
    if (last.code === 0) {
      return last;
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts. lastCode=${last?.code}\nstdout=${last?.stdout}\nstderr=${last?.stderr}`);
}

describe("real cli e2e fullflow", () => {
  beforeAll(async () => {
    await ensureRealLlmEnvironment();
    await execFileAsync("npm", ["run", "build"], {
      cwd: ROOT,
      maxBuffer: 32 * 1024 * 1024
    });
  }, 240_000);

  it(
    "runs plan -> converge(plan) -> execute -> verify -> converge(exec) via CLI with strict external",
    async () => {
      const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-real-cli-e2e-"));
      await copyRealAdvisorScripts(ROOT, cwd);

      const env = {
        ...process.env,
        SALACIA_PROMPT_LLM: "off",
        SALACIA_CONVERGE_TIMEOUT_MS: "60000",
        SALACIA_CONVERGE_RETRIES: "0"
      };

      const initRes = await runCli(CLI_PATH, ["init", "--json"], cwd, env);
      expect(initRes.code).toBe(0);

      const planRes = await runCli(
        CLI_PATH,
        ["plan", "implement login flow, keep api stable, add tests", "--json"],
        cwd,
        env
      );
      expect(planRes.code).toBe(0);
      const planPayload = parseJsonOutput(planRes.stdout) as PlanPayload;
      expect(planPayload.ok).toBe(true);
      await fs.access(planPayload.contractPath);
      await fs.access(planPayload.planPath);
      await fs.access(planPayload.specPath);

      // Make artifact and verification quality explicit so external advisors can approve deterministically.
      const verifyCmd = `node -e "const fs=require('fs');const files=['${planPayload.contractPath}','${planPayload.planPath}','${planPayload.specPath}'];for(const p of files){if(!fs.existsSync(p)){process.exit(1);}}process.exit(0);"`;
      const planRaw = await fs.readFile(planPayload.planPath, "utf8");
      const plan = JSON.parse(planRaw) as {
        contractId: string;
        generatedAt: string;
        summary: string;
        steps: Array<{ id: string; riskLevel: string; expectedArtifacts: string[]; verification: string[] }>;
      };
      plan.steps = [
        {
          id: "validate-planning-artifacts",
          riskLevel: "low",
          expectedArtifacts: [planPayload.contractPath, planPayload.planPath, planPayload.specPath],
          verification: [verifyCmd]
        }
      ];
      await fs.writeFile(planPayload.planPath, JSON.stringify(plan, null, 2), "utf8");

      const contractRaw = await fs.readFile(planPayload.contractPath, "utf8");
      const contract = yaml.load(contractRaw) as {
        scope: { inScope: string[]; outOfScope: string[] };
        plan: {
          steps: Array<{
            id: string;
            riskLevel: string;
            expectedArtifacts: string[];
            verification: string[];
          }>;
        };
        verification: { commands: string[] };
      };
      contract.scope.inScope = [
        "Generate consistent contract/spec/plan artifacts for login flow delivery",
        "Keep public API stable while validating planning artifacts"
      ];
      contract.scope.outOfScope = ["secrets/**", "**/.env*"];
      contract.plan.steps = [
        {
          id: "validate-planning-artifacts",
          riskLevel: "low",
          expectedArtifacts: [planPayload.contractPath, planPayload.planPath, planPayload.specPath],
          verification: [verifyCmd]
        }
      ];
      contract.verification.commands = [verifyCmd];
      await fs.writeFile(planPayload.contractPath, yaml.dump(contract, { noRefs: true }), "utf8");

      await fs.writeFile(
        planPayload.specPath,
        [
          `# Spec: ${plan.contractId}`,
          "",
          "## Goal",
          "Implement login flow while keeping API stable and adding verification coverage.",
          "",
          "## Constraints",
          "- Keep API compatibility for existing callers.",
          "- Keep changes auditable and reversible.",
          "",
          "## Scope",
          "### In Scope",
          "- Contract, spec, and plan artifact consistency checks",
          "- Verification command coverage for expected artifacts",
          "",
          "### Out of Scope",
          "- secrets/**",
          "- **/.env*",
          "",
          "## Plan",
          "1. validate-planning-artifacts (low)",
          `   - Artifacts: ${planPayload.contractPath}, ${planPayload.planPath}, ${planPayload.specPath}`,
          `   - Verify: ${verifyCmd}`,
          "",
          "## Verification",
          `- \`${verifyCmd}\``
        ].join("\n"),
        "utf8"
      );

      const convergePlanRes = await runCliUntilZero(
        "converge(plan)",
        () =>
          runCli(
            CLI_PATH,
            [
              "converge",
              "--stage",
              "plan",
              "--input",
              planPayload.planPath,
              "--external",
              "--strict-external",
              "--json"
            ],
            cwd,
            env
          ),
        2
      );
      const convergePlanPayload = parseJsonOutput(convergePlanRes.stdout) as {
        winner: string;
        advisors: Array<{ advisor: string; parseStatus?: string; vote: string; evidenceRef?: string }>;
      };
      expect(convergePlanPayload.winner).toBe("approve");
      const planExternalOk = convergePlanPayload.advisors.filter(
        (item) =>
          item.advisor !== "codex" &&
          item.parseStatus === "ok" &&
          item.vote !== "abstain" &&
          (item.evidenceRef ?? "").length > 0
      );
      expect(planExternalOk.length).toBeGreaterThan(0);

      const executeRes = await runCliUntilZero(
        "execute",
        () =>
          runCli(
            CLI_PATH,
            [
              "execute",
              "--adapter",
              "vscode",
              "--dry-run",
              "--external",
              "--strict-external",
              "--json"
            ],
            cwd,
            env
          ),
        2
      );
      const executePayload = parseJsonOutput(executeRes.stdout) as ExecutePayload;
      expect(executePayload.ok).toBe(true);
      await fs.access(executePayload.execution.executionPath);
      await fs.access(executePayload.execution.verifyPath);
      await fs.access(executePayload.execution.execEvidencePath);

      const verifyRes = await runCli(CLI_PATH, ["verify", "--json"], cwd, env);
      expect(verifyRes.code).toBe(0);
      const verifyPayload = parseJsonOutput(verifyRes.stdout) as { ok: boolean };
      expect(verifyPayload.ok).toBe(true);

      const convergeExecRes = await runCliUntilZero(
        "converge(exec)",
        () =>
          runCli(
            CLI_PATH,
            [
              "converge",
              "--stage",
              "exec",
              "--input",
              executePayload.execution.execEvidencePath,
              "--external",
              "--strict-external",
              "--json"
            ],
            cwd,
            env
          ),
        2
      );
      const convergeExecPayload = parseJsonOutput(convergeExecRes.stdout) as {
        winner: string;
        advisors: Array<{ advisor: string; parseStatus?: string; vote: string; evidenceRef?: string }>;
      };
      expect(convergeExecPayload.winner).toBe("approve");
      const execExternalOk = convergeExecPayload.advisors.filter(
        (item) =>
          item.advisor !== "codex" &&
          item.parseStatus === "ok" &&
          item.vote !== "abstain" &&
          (item.evidenceRef ?? "").length > 0
      );
      expect(execExternalOk.length).toBeGreaterThan(0);
    },
    420_000
  );
});
