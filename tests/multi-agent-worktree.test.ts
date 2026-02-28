import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import type { ExecutorAdapter } from "../src/adapters/base.js";
import type {
  AdapterCapability,
  AdapterCapabilityMatrix,
  BridgeHealthReport,
  ExecuteOptions,
  ExecutionResult,
  Plan,
  ValidationResult
} from "../src/core/types.js";
import { runMultiAgentExecution } from "../src/harness/multi-agent.js";
import { createRoleWorktree, removeRoleWorktree } from "../src/harness/worktree.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

async function initGitRepo(root: string): Promise<void> {
  await git(root, "init");
  await git(root, "config", "user.email", "salacia@example.com");
  await git(root, "config", "user.name", "Salacia Test");
  await fs.writeFile(path.join(root, "README.md"), "# test\n", "utf8");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "init");
}

function makePlan(): Plan {
  return {
    contractId: "contract-test",
    generatedAt: new Date().toISOString(),
    summary: "test plan",
    steps: [
      {
        id: "step-1",
        riskLevel: "low",
        expectedArtifacts: [],
        verification: ["node -e \"process.exit(0)\""]
      }
    ]
  };
}

function makeMockAdapter(): ExecutorAdapter {
  const capabilities: AdapterCapability[] = ["execute", "verify"];

  return {
    name: "mock",
    kind: "executor",
    supportLevel: "ga",
    capabilities: () => capabilities,
    health: async (): Promise<BridgeHealthReport> => ({
      target: "mock",
      available: true,
      checks: [{ name: "mock", ok: true, detail: "ok" }]
    }),
    isAvailable: async () => true,
    execute: async (_plan: Plan, _options: ExecuteOptions): Promise<ExecutionResult> => ({
      adapter: "mock",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      success: true,
      summary: "ok",
      output: "ok",
      artifacts: []
    }),
    validate: async (_result: ExecutionResult): Promise<ValidationResult> => ({
      valid: true,
      messages: ["ok"]
    }),
    matrixRow: async (): Promise<AdapterCapabilityMatrix> => ({
      target: "mock",
      kind: "executor",
      available: true,
      supportLevel: "ga",
      capabilities
    })
  };
}

describe("worktree isolation", () => {
  it("creates and removes dedicated worktree when git repository is available", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-worktree-git-"));
    await initGitRepo(root);

    const session = await createRoleWorktree(root, "reviewer", "run-test", "step-1");
    expect(session.created).toBe(true);
    expect(session.fallback).toBe(false);
    expect(session.path).not.toBe(root);

    const stat = await fs.stat(session.path);
    expect(stat.isDirectory()).toBe(true);

    const cleanup = await removeRoleWorktree(root, session);
    expect(cleanup.ok).toBe(true);
    const existsAfterCleanup = await fs
      .access(session.path)
      .then(() => true)
      .catch(() => false);
    expect(existsAfterCleanup).toBe(false);
  });

  it("falls back to root path when repository is not git-enabled", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-worktree-fallback-"));
    const session = await createRoleWorktree(root, "reviewer", "run-test", "step-1");
    expect(session.created).toBe(false);
    expect(session.fallback).toBe(true);
    expect(session.path).toBe(root);

    const cleanup = await removeRoleWorktree(root, session);
    expect(cleanup.ok).toBe(true);
  });
});

describe("multi-agent execution", () => {
  it("runs side-agent roles with worktree fanout and cleanup", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-multi-agent-"));
    await initGitRepo(root);

    const summary = await runMultiAgentExecution(makeMockAdapter(), makePlan(), {
      cwd: root,
      stage: "exec",
      mode: "auto",
      dryRun: true,
      roles: ["reviewer"],
      fanout: 1
    });

    expect(summary.topology).toBe("multi");
    expect(summary.orchestrator.completed).toBe(1);
    expect(summary.orchestrator.failed).toBe(0);
    expect(summary.roleRuns.length).toBe(1);
    expect(summary.worktrees.created).toBe(1);
    expect(summary.worktrees.cleanupFailed).toBe(0);
    expect(summary.roleSummary.failedRuns).toBe(0);
    expect(summary.mergePolicy.policy).toBe("deterministic-majority-v1");
    expect(summary.mergePolicy.requiresHumanGate).toBe(false);
  });
});
