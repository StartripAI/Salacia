import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { createContractFromVibe, saveContract } from "../src/core/contract.js";
import { ensureSalaciaDirs } from "../src/core/paths.js";
import { derivePlan, savePlan } from "../src/core/plan.js";
import {
  copyRealAdvisorScripts,
  ensureRealLlmEnvironment,
  parseJsonOutput,
  runCli
} from "./helpers/real-e2e.js";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const CLI_PATH = path.join(ROOT, "dist", "cli", "index.js");

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd, maxBuffer: 8 * 1024 * 1024 });
}

describe("real e2e failure branches", () => {
  beforeAll(async () => {
    await ensureRealLlmEnvironment();
    await execFileAsync("npm", ["run", "build"], {
      cwd: ROOT,
      maxBuffer: 32 * 1024 * 1024
    });
  }, 240_000);

  it("covers converge non-pass path on malformed artifact with strict external", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-real-converge-fail-"));
    await copyRealAdvisorScripts(ROOT, cwd);

    const env = {
      ...process.env,
      SALACIA_PROMPT_LLM: "on",
      SALACIA_PROMPT_LLM_PROVIDER: "chatgpt"
    };

    const badArtifact = path.join(cwd, "malformed-plan.txt");
    await fs.writeFile(badArtifact, "not a structured plan artifact", "utf8");

    const res = await runCli(
      CLI_PATH,
      [
        "converge",
        "--stage",
        "plan",
        "--input",
        badArtifact,
        "--external",
        "--strict-external",
        "--json"
      ],
      cwd,
      env
    );

    expect(res.code).not.toBe(0);
    const payload = parseJsonOutput(res.stdout) as {
      winner: string;
      requiresHumanApproval: boolean;
      conflicts: string[];
    };
    expect(payload.winner === "reject" || payload.requiresHumanApproval).toBe(true);
    expect(payload.conflicts.length).toBeGreaterThan(0);
  }, 240_000);

  it("covers verify fail path with non-zero verification commands", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-real-verify-fail-"));
    const env = { ...process.env };
    const paths = await ensureSalaciaDirs(cwd);
    const contract = createContractFromVibe("verify failure branch", "verify-fail");
    contract.verification.commands = ['node -e "process.exit(1)"'];
    await saveContract(contract, path.join(paths.contracts, "verify-fail.yaml"));

    const verifyRes = await runCli(CLI_PATH, ["verify", "--json"], cwd, env);
    expect(verifyRes.code).not.toBe(0);
    const verifyPayload = parseJsonOutput(verifyRes.stdout) as {
      ok: boolean;
      verification?: { results?: Array<{ success: boolean }> };
    };
    expect(verifyPayload.ok).toBe(false);
    expect((verifyPayload.verification?.results ?? []).some((result) => result.success === false)).toBe(true);
  });

  it("covers consistency block path on high-risk drift", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-real-consistency-block-"));
    await git(root, ["init"]);
    await git(root, ["config", "user.email", "salacia-e2e@example.com"]);
    await git(root, ["config", "user.name", "Salacia E2E"]);

    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "index.ts"), "export const ok = true;\n", "utf8");
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "seed"]);

    const contract = createContractFromVibe("real consistency block", "real-consistency");
    contract.scope.inScope = ["src/"];
    contract.verification.commands = ['node -e "process.exit(0)"'];
    const plan = derivePlan(contract);
    for (const step of plan.steps) {
      step.verification = ['node -e "process.exit(0)"'];
    }
    const paths = await ensureSalaciaDirs(root);
    await saveContract(contract, path.join(paths.contracts, "consistency-block.yaml"));
    await savePlan(plan, path.join(paths.plans, "consistency-block.json"));

    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.writeFile(path.join(root, "docs", "a.md"), "a", "utf8");
    await fs.writeFile(path.join(root, "docs", "b.md"), "b", "utf8");
    await fs.writeFile(path.join(root, "docs", "c.md"), "c", "utf8");
    await fs.writeFile(path.join(root, "docs", "d.md"), "d", "utf8");

    const env = { ...process.env };
    const guardRes = await runCli(CLI_PATH, ["guard", "consistency", "--json"], root, env);
    expect(guardRes.code).not.toBe(0);
    const payload = parseJsonOutput(guardRes.stdout) as {
      ok: boolean;
      report: { violations: Array<{ code: string; severity: string }> };
    };

    expect(payload.ok).toBe(false);
    expect(payload.report.violations.some((item) => item.code === "contract-drift" && item.severity === "high")).toBe(true);
  });
});
