import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const CLI_PATH = path.join(ROOT, "dist", "cli", "index.js");

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[], cwd = ROOT): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [CLI_PATH, ...args], {
      cwd,
      maxBuffer: 8 * 1024 * 1024
    });
    return {
      code: 0,
      stdout: String(stdout),
      stderr: String(stderr)
    };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof e.code === "number" ? e.code : 1,
      stdout: String(e.stdout ?? ""),
      stderr: String(e.stderr ?? "")
    };
  }
}

function parseJsonOutput(raw: string): unknown {
  return JSON.parse(raw.trim());
}

describe("cli command contract", () => {
  beforeAll(async () => {
    await execFileAsync("npm", ["run", "build"], {
      cwd: ROOT,
      maxBuffer: 32 * 1024 * 1024
    });
  }, 120_000);

  it("registers all required top-level commands", async () => {
    const res = await runCli(["--help"]);
    expect(res.code).toBe(0);
    const help = `${res.stdout}\n${res.stderr}`;
    const required = [
      "init",
      "forge",
      "plan",
      "prompt",
      "converge",
      "validate",
      "verify",
      "guard",
      "execute",
      "snapshot",
      "rollback",
      "status",
      "clean",
      "adapters",
      "doctor",
      "audit",
      "benchmark",
      "mcp-server",
      "mcp-describe"
    ];
    for (const command of required) {
      expect(help.includes(command), `missing command in help: ${command}`).toBe(true);
    }
  });

  it("exposes benchmark sub-actions", async () => {
    const res = await runCli(["benchmark", "--help"]);
    expect(res.code).toBe(0);
    const help = `${res.stdout}\n${res.stderr}`;
    expect(help).toContain("run|compare|verify|report|sota-check|measure|public-run|public-audit|public-campaign");
    expect(help).toContain("--no-scaffold");
    expect(help).toContain("--public-model-chain");
    expect(help).toContain("--sample");
    expect(help).toContain("--concurrency");
    expect(help).toContain("--resume");
    expect(help).toContain("--strict");
    expect(help).toContain("--public-strict-min-model-attempted-rate");
  });

  it("exposes execute rollback options", async () => {
    const res = await runCli(["execute", "--help"]);
    expect(res.code).toBe(0);
    const help = `${res.stdout}\n${res.stderr}`;
    expect(help).toContain("--agent-topology");
    expect(help).toContain("--agent-roles");
    expect(help).toContain("--worktree-fanout");
    expect(help).toContain("--coordination-protocol");
    expect(help).toContain("--strict-external");
    expect(help).toContain("--no-auto-rollback");
    expect(help).toContain("--rollback-retries");
  });

  it("keeps plan prompt compilation pipeline wired through runtime behavior", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-cli-plan-"));
    const initRes = await runCli(["init", "--json"], cwd);
    expect(initRes.code).toBe(0);

    const planRes = await runCli(
      ["plan", "implement login, add tests, do not break API", "--json"],
      cwd
    );
    expect(planRes.code).toBe(0);
    const payload = parseJsonOutput(planRes.stdout) as {
      ok: boolean;
      intentPath: string;
      contractPath: string;
      planPath: string;
      specPath: string;
    };

    expect(payload.ok).toBe(true);
    const expectedPaths = [payload.intentPath, payload.contractPath, payload.planPath, payload.specPath];
    for (const item of expectedPaths) {
      expect(typeof item).toBe("string");
      const stat = await fs.stat(item);
      expect(stat.isFile()).toBe(true);
    }
  });

  it("keeps forge alias wired to the same pipeline output contract", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-cli-forge-"));
    const initRes = await runCli(["init", "--json"], cwd);
    expect(initRes.code).toBe(0);

    const forgeRes = await runCli(
      ["forge", "implement audit-safe login flow with tests", "--json"],
      cwd
    );
    expect(forgeRes.code).toBe(0);
    const payload = parseJsonOutput(forgeRes.stdout) as {
      ok: boolean;
      intentPath: string;
      contractPath: string;
      planPath: string;
      specPath: string;
    };

    expect(payload.ok).toBe(true);
    const expectedPaths = [payload.intentPath, payload.contractPath, payload.planPath, payload.specPath];
    for (const item of expectedPaths) {
      expect(typeof item).toBe("string");
      const stat = await fs.stat(item);
      expect(stat.isFile()).toBe(true);
    }
  });

  it("supports deterministic json output mode across commands", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-cli-status-"));
    const initRes = await runCli(["init", "--json"], cwd);
    expect(initRes.code).toBe(0);

    const statusRes = await runCli(["status", "--json"], cwd);
    expect(statusRes.code).toBe(0);
    const status = parseJsonOutput(statusRes.stdout) as {
      ok: boolean;
      counts: { contracts: number; specs: number; plans: number; snapshots: number };
    };
    expect(status.ok).toBe(true);
    expect(typeof status.counts.contracts).toBe("number");
    expect(typeof status.counts.plans).toBe("number");
  });

  it("returns structured error for benchmark verify without run id", async () => {
    const res = await runCli(["benchmark", "verify", "--json"]);
    expect(res.code).not.toBe(0);
    const payload = parseJsonOutput(res.stdout) as { ok: boolean; error: string };
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain("requires --run");
  });
});
