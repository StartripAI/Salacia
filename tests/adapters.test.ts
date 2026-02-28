import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AntigravityAdapter } from "../src/adapters/antigravity.js";
import { ClaudeCodeAdapter } from "../src/adapters/claude-code.js";
import { ClineAdapter } from "../src/adapters/cline.js";
import { CodexAdapter } from "../src/adapters/codex.js";
import { CursorAdapter } from "../src/adapters/cursor.js";
import { OpenCodeAdapter } from "../src/adapters/opencode.js";
import { VSCodeAdapter } from "../src/adapters/vscode.js";
import { adapterMatrix, findAdapter } from "../src/adapters/registry.js";
import type { Plan } from "../src/core/types.js";

function makePlan(): Plan {
  return {
    contractId: "test-contract",
    generatedAt: new Date().toISOString(),
    summary: "adapter test",
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

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ide bridge adapters", () => {
  it("cursor adapter writes rule and task artifacts", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-cursor-"));
    const adapter = new CursorAdapter();
    const result = await adapter.execute(makePlan(), { cwd, dryRun: true, stage: "exec", mode: "auto" });

    expect(result.success).toBe(true);
    expect(result.artifacts.some((item) => item.includes(".cursor/rules/salacia.mdc"))).toBe(true);
    expect(result.artifacts.some((item) => item.includes(".cursor/rules/salacia-step-1.json"))).toBe(true);
  });

  it("cline adapter writes step markdown artifact", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-cline-"));
    const adapter = new ClineAdapter();
    const result = await adapter.execute(makePlan(), { cwd, dryRun: true, stage: "exec", mode: "auto" });

    expect(result.success).toBe(true);
    expect(result.artifacts.some((item) => item.includes(".cline/salacia-step-step-1.md"))).toBe(true);
  });

  it("vscode adapter writes tasks.json artifact", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-vscode-"));
    const adapter = new VSCodeAdapter();
    const result = await adapter.execute(makePlan(), { cwd, dryRun: true, stage: "exec", mode: "auto" });

    expect(result.success).toBe(true);
    expect(result.artifacts.some((item) => item.includes(".vscode/tasks.json"))).toBe(true);
  });

  it("antigravity adapter writes bridge payload artifact", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-anti-"));
    const adapter = new AntigravityAdapter();
    const result = await adapter.execute(makePlan(), { cwd, dryRun: true, stage: "exec", mode: "auto" });

    expect(result.success).toBe(true);
    expect(result.artifacts.some((item) => item.includes(".antigravity/salacia-step-1.json"))).toBe(true);
  });

  it("ide adapters expose bridge capabilities", () => {
    const adapters = [new CursorAdapter(), new ClineAdapter(), new VSCodeAdapter(), new AntigravityAdapter()];
    for (const adapter of adapters) {
      expect(adapter.capabilities().includes("bridge-status")).toBe(true);
      expect(adapter.kind).toBe("ide-bridge");
    }
  });

  it("ide adapter health reports are available", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-ide-health-"));
    const adapters = [new CursorAdapter(), new ClineAdapter(), new VSCodeAdapter(), new AntigravityAdapter()];
    for (const adapter of adapters) {
      const health = await adapter.health(cwd);
      expect(health.available).toBe(true);
      expect(health.checks.length).toBeGreaterThan(0);
    }
  });
});

describe("executor adapters", () => {
  it("claude adapter uses user-endpoint probe in dry-run mode", async () => {
    vi.stubEnv("SALACIA_CLAUDE_BIN", process.execPath);
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-claude-"));
    const adapter = new ClaudeCodeAdapter();
    const result = await adapter.execute(makePlan(), { cwd, dryRun: true, stage: "exec", mode: "cli" });

    expect(result.success).toBe(true);
    expect(result.output.toLowerCase()).toContain("user-endpoint probe");
  });

  it("claude adapter health reflects token status", async () => {
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    const adapter = new ClaudeCodeAdapter();
    const health = await adapter.health(process.cwd());
    const sourceCheck = health.checks.find((check) => check.name === "endpoint-source");
    const tokenCheck = health.checks.find((check) => check.name === "token");
    expect(sourceCheck?.ok).toBe(true);
    expect(tokenCheck?.ok).toBe(false);
  });

  it("codex adapter returns structured result even when command route is unavailable", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-codex-"));
    const adapter = new CodexAdapter();
    const result = await adapter.execute(makePlan(), { cwd, dryRun: true, stage: "exec", mode: "auto" });

    expect(typeof result.success).toBe("boolean");
    expect(typeof result.output).toBe("string");
    expect(result.artifacts.length).toBeGreaterThan(0);
  });

  it("codex adapter exposes route health details", async () => {
    const adapter = new CodexAdapter();
    const health = await adapter.health(process.cwd());
    expect(health.checks.some((check) => check.name === "route")).toBe(true);
  });

  it("opencode adapter returns structured execution result", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-opencode-"));
    const adapter = new OpenCodeAdapter();
    const result = await adapter.execute(makePlan(), { cwd, dryRun: true, stage: "exec", mode: "auto" });

    expect(typeof result.success).toBe("boolean");
    expect(typeof result.output).toBe("string");
    expect(result.artifacts.length).toBeGreaterThan(0);
  }, 20_000);

  it("executor adapters validate results consistently", async () => {
    const plan = makePlan();
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-executor-validate-"));
    const adapters = [new CodexAdapter(), new OpenCodeAdapter()];
    for (const adapter of adapters) {
      const result = await adapter.execute(plan, { cwd, dryRun: true, stage: "exec", mode: "cli" });
      const validation = await adapter.validate(result);
      expect(validation.valid).toBe(result.success);
      expect(validation.messages.length).toBeGreaterThan(0);
    }
  }, 20_000);

  it("executor adapters expose core execution capabilities", () => {
    const adapters = [new ClaudeCodeAdapter(), new CodexAdapter(), new OpenCodeAdapter()];
    for (const adapter of adapters) {
      const capabilities = adapter.capabilities();
      expect(capabilities.includes("execute")).toBe(true);
      expect(capabilities.includes("verify")).toBe(true);
      expect(adapter.kind).toBe("executor");
    }
  });
});

describe("adapter registry and matrix", () => {
  it("matrix returns all target rows", async () => {
    const rows = await adapterMatrix(process.cwd());
    expect(rows.length).toBe(7);
  });

  it("matrix codex row includes WSL routing note", async () => {
    const rows = await adapterMatrix(process.cwd());
    const codex = rows.find((row) => row.target === "codex");
    expect(codex?.notes?.toLowerCase()).toContain("wsl");
  });

  it("findAdapter resolves known targets", () => {
    expect(findAdapter("claude-code")).toBeDefined();
    expect(findAdapter("cursor")).toBeDefined();
    expect(findAdapter("unknown-target")).toBeUndefined();
  });

  it("matrix rows include support level and capabilities", async () => {
    const rows = await adapterMatrix(process.cwd());
    for (const row of rows) {
      expect(row.supportLevel.length).toBeGreaterThan(0);
      expect(row.capabilities.length).toBeGreaterThan(0);
    }
  });
});
