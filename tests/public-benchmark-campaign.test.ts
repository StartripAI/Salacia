import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();

function parseJsonFromMixed(raw: string): any {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(raw.slice(start, end + 1));
  }

  throw new Error(`unable to parse json payload: ${raw.slice(0, 400)}`);
}

async function runNode(args: string[], cwd = ROOT, env?: NodeJS.ProcessEnv) {
  return runCommand("node", args, cwd, env);
}

async function runCommand(cmd: string, args: string[], cwd = ROOT, env?: NodeJS.ProcessEnv) {
  const { stdout, stderr } = await execFileAsync(cmd, args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    maxBuffer: 64 * 1024 * 1024
  });
  return {
    stdout: String(stdout),
    stderr: String(stderr)
  };
}

async function writeStubRunner(filePath: string): Promise<void> {
  const content = [
    '#!/usr/bin/env node',
    'import fs from "node:fs/promises";',
    '',
    'const args = process.argv.slice(2);',
    'const arg = (name, fallback = "") => {',
    '  const idx = args.indexOf(name);',
    '  if (idx === -1) return fallback;',
    '  return args[idx + 1] ?? fallback;',
    '};',
    'const has = (name) => args.includes(name);',
    '',
    'const instance = String(arg("--instance", "")).trim();',
    'const group = String(arg("--group", "scaffold")).trim();',
    'const noScaffold = has("--no-scaffold");',
    'const runId = String(arg("--run-id", `${Date.now()}-stub`));',
    'const sampleId = String(arg("--sample-id", "sample"));',
    'const instanceIndex = Number.parseInt(String(arg("--instance-index", "1")), 10);',
    'const modelChain = String(arg("--model-chain", "m1,m2")).split(",").map((x) => x.trim()).filter(Boolean);',
    'const pass = group === "scaffold" ? true : instance.endsWith("1");',
    'const selectedModel = modelChain[0] ?? null;',
    'const modelProbeEvidence = { attempted: modelChain, failures: pass ? [] : [{ model: selectedModel ?? "n/a", reason: "stub-fail" }] };',
    'const result = {',
    '  ok: pass,',
    '  status: pass ? "pass" : "fail",',
    '  suite: "swebench_verified_real_single",',
    '  standard: "SWE-bench Verified (stub)",',
    '  group,',
    '  scaffoldEnabled: !noScaffold,',
    '  modelChain,',
    '  selectedModel,',
    '  modelProbeEvidence,',
    '  sampleId,',
    '  instanceIndex,',
    '  reason: pass ? "stub-pass" : "stub-fail",',
    '  officialComparable: false',
    '};',
    'const logPath = process.env.STUB_LOG_PATH;',
    'if (logPath) {',
    '  await fs.appendFile(logPath, JSON.stringify({ instance, group, noScaffold, runId, modelChain }) + "\\n", "utf8");',
    '}',
    'console.log(JSON.stringify({ ok: true, runId, group, scaffoldEnabled: !noScaffold, modelChain, selectedModel, modelProbeEvidence, results: [result] }, null, 2));',
    ''
  ].join("\n");

  await fs.writeFile(filePath, content, "utf8");
  await fs.chmod(filePath, 0o755);
}

async function writeInfraBlockStubRunner(filePath: string): Promise<void> {
  const content = [
    '#!/usr/bin/env node',
    '',
    'const args = process.argv.slice(2);',
    'const arg = (name, fallback = "") => {',
    '  const idx = args.indexOf(name);',
    '  if (idx === -1) return fallback;',
    '  return args[idx + 1] ?? fallback;',
    '};',
    'const has = (name) => args.includes(name);',
    'const group = String(arg("--group", "scaffold")).trim();',
    'const runId = String(arg("--run-id", `${Date.now()}-stub`));',
    'const sampleId = String(arg("--sample-id", "sample"));',
    'const instanceIndex = Number.parseInt(String(arg("--instance-index", "1")), 10);',
    'const modelChain = String(arg("--model-chain", "m1,m2")).split(",").map((x) => x.trim()).filter(Boolean);',
    'const noScaffold = has("--no-scaffold");',
    '',
    'const blocked = group === "bare";',
    'const result = {',
    '  ok: !blocked,',
    '  status: blocked ? "blocked" : "pass",',
    '  suite: "swebench_verified_real_single",',
    '  standard: "SWE-bench Verified (stub)",',
    '  group,',
    '  scaffoldEnabled: !noScaffold,',
    '  modelChain,',
    '  selectedModel: modelChain[0] ?? null,',
    '  modelProbeEvidence: { attempted: modelChain, failures: [] },',
    '  sampleId,',
    '  instanceIndex,',
    '  reason: blocked ? "docker daemon unavailable: Command failed: docker info" : "stub-pass",',
    '  officialComparable: false,',
    '  metrics: { failureCategory: blocked ? "infra-block" : null }',
    '};',
    '',
    'console.log(JSON.stringify({ ok: true, runId, group, scaffoldEnabled: !noScaffold, modelChain, results: [result] }, null, 2));',
    ''
  ].join("\n");
  await fs.writeFile(filePath, content, "utf8");
  await fs.chmod(filePath, 0o755);
}

describe("public benchmark campaign scripts", () => {
  it("generates reproducible stratified sample from fixture data", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-sample-"));
    const fixturePath = path.join(tmp, "instances.json");
    const outA = path.join(tmp, "sample-a.json");
    const outB = path.join(tmp, "sample-b.json");
    const outC = path.join(tmp, "sample-c.json");

    const fixture: Array<{ instance_id: string; repo: string }> = [];
    for (let i = 1; i <= 30; i += 1) {
      fixture.push({ instance_id: `repoA__issue-${i}`, repo: "org/repoA" });
    }
    for (let i = 1; i <= 20; i += 1) {
      fixture.push({ instance_id: `repoB__issue-${i}`, repo: "org/repoB" });
    }
    for (let i = 1; i <= 10; i += 1) {
      fixture.push({ instance_id: `repoC__issue-${i}`, repo: "org/repoC" });
    }
    await fs.writeFile(fixturePath, JSON.stringify(fixture, null, 2), "utf8");

    await runCommand("python3", [
      "scripts/swebench-sample.py",
      "--instances-file", fixturePath,
      "--count", "20",
      "--seed", "42",
      "--output", outA
    ]);

    await runCommand("python3", [
      "scripts/swebench-sample.py",
      "--instances-file", fixturePath,
      "--count", "20",
      "--seed", "42",
      "--output", outB
    ]);

    await runCommand("python3", [
      "scripts/swebench-sample.py",
      "--instances-file", fixturePath,
      "--count", "20",
      "--seed", "7",
      "--output", outC
    ]);

    const [a, b, c] = await Promise.all([
      fs.readFile(outA, "utf8"),
      fs.readFile(outB, "utf8"),
      fs.readFile(outC, "utf8")
    ]);

    expect(a).toBe(b);
    expect(a).not.toBe(c);

    const parsed = JSON.parse(a) as { count: number; instances: unknown[]; strata: Array<{ selected: number }> };
    expect(parsed.count).toBe(20);
    expect(parsed.instances).toHaveLength(20);
    expect(parsed.strata.reduce((sum, row) => sum + row.selected, 0)).toBe(20);
  });

  it("runs paired campaign and writes paired summary artifacts", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-campaign-"));
    const samplePath = path.join(tmp, "sample.json");
    const stubRunner = path.join(tmp, "stub-runner.mjs");
    const stubLog = path.join(tmp, "stub.log");
    const outputJson = path.join(tmp, "paired-results.json");
    const outputMd = path.join(tmp, "paired-results.md");

    await writeStubRunner(stubRunner);
    await fs.writeFile(stubLog, "", "utf8");

    const sample = {
      dataset: "SWE-bench/SWE-bench_Verified",
      split: "test",
      seed: 42,
      count: 3,
      sampleId: "test-seed-42",
      instances: [
        { instance_id: "repo__issue-1", repo: "org/repo", stratum: "org/repo", instanceIndex: 1 },
        { instance_id: "repo__issue-2", repo: "org/repo", stratum: "org/repo", instanceIndex: 2 },
        { instance_id: "repo__issue-3", repo: "org/repo", stratum: "org/repo", instanceIndex: 3 }
      ]
    };
    await fs.writeFile(samplePath, JSON.stringify(sample, null, 2), "utf8");

    const run = await runNode(
      [
        "scripts/run-swebench-campaign.mjs",
        "--sample", samplePath,
        "--group", "both",
        "--concurrency", "2",
        "--timeout-ms", "20000",
        "--backend", "codex",
        "--model-chain", "gpt-5.2-codex,gpt-5.1-codex",
        "--output-json", outputJson,
        "--output-md", outputMd,
        "--runner", stubRunner
      ],
      ROOT,
      { STUB_LOG_PATH: stubLog }
    );

    const payload = parseJsonFromMixed(run.stdout) as {
      ok: boolean;
      campaignId: string;
      campaignDir: string;
      summaryFinalPath: string;
      finalSummary: {
        paired: { pairComplete: number; pairCompleteRate: number };
        byGroup: { scaffold: { total: number }; bare: { total: number } };
      };
      reports: { json: string; md: string };
    };

    expect(payload.ok).toBe(true);
    expect(payload.finalSummary.paired.pairComplete).toBe(3);
    expect(payload.finalSummary.paired.pairCompleteRate).toBe(1);
    expect(payload.finalSummary.byGroup.scaffold.total).toBe(3);
    expect(payload.finalSummary.byGroup.bare.total).toBe(3);

    const summaryExists = await fs.access(payload.summaryFinalPath).then(() => true).catch(() => false);
    const reportJsonExists = await fs.access(payload.reports.json).then(() => true).catch(() => false);
    const reportMdExists = await fs.access(payload.reports.md).then(() => true).catch(() => false);
    expect(summaryExists).toBe(true);
    expect(reportJsonExists).toBe(true);
    expect(reportMdExists).toBe(true);

    const analyzeReport = JSON.parse(await fs.readFile(payload.reports.json, "utf8")) as {
      executionContext: {
        totalRuns: number;
        infraBlockedRuns: number;
        modelAttemptedRuns: number;
      };
      failureBreakdown: {
        overall: {
          totalFail: number;
          buckets: Record<string, number>;
          rawReasonCounts: Array<{ reason: string; count: number }>;
        };
        byGroup: {
          scaffold: { buckets: Record<string, number> };
          bare: { buckets: Record<string, number> };
        };
      };
    };
    expect(analyzeReport.executionContext.totalRuns).toBe(6);
    expect(analyzeReport.executionContext.infraBlockedRuns).toBe(0);
    expect(analyzeReport.executionContext.modelAttemptedRuns).toBe(6);
    expect(analyzeReport.failureBreakdown.overall.totalFail).toBe(2);
    expect(analyzeReport.failureBreakdown.overall.buckets["model-fail"]).toBe(2);
    expect(analyzeReport.failureBreakdown.overall.buckets["infra-block"]).toBe(0);
    expect(analyzeReport.failureBreakdown.overall.buckets["contract-block"]).toBe(0);
    expect(analyzeReport.failureBreakdown.overall.buckets["rollback-fail"]).toBe(0);
    expect(analyzeReport.failureBreakdown.overall.buckets["eval-fail"]).toBe(0);
    expect(analyzeReport.failureBreakdown.byGroup.scaffold.buckets["model-fail"]).toBe(0);
    expect(analyzeReport.failureBreakdown.byGroup.scaffold.buckets["infra-block"]).toBe(0);
    expect(analyzeReport.failureBreakdown.byGroup.bare.buckets["model-fail"]).toBe(2);
    expect(analyzeReport.failureBreakdown.byGroup.bare.buckets["infra-block"]).toBe(0);
    expect(
      analyzeReport.failureBreakdown.overall.rawReasonCounts.some((row) => row.reason === "stub-fail" && row.count === 2)
    ).toBe(true);

    const analyzeMarkdown = await fs.readFile(payload.reports.md, "utf8");
    expect(analyzeMarkdown).toContain("# SWE-bench 3 Paired Result");
    expect(analyzeMarkdown).toContain("## Execution Context");
    expect(analyzeMarkdown).toContain("## Failure Breakdown");
    expect(analyzeMarkdown).toContain("model-fail");
    expect(analyzeMarkdown).toContain("infra-block");

    const campaignStatePath = path.join(payload.campaignDir, "campaign.state.json");
    const campaignState = JSON.parse(await fs.readFile(campaignStatePath, "utf8")) as {
      results: Array<{
        key: string;
        group: string;
        sampleId: string;
        modelChain: string[];
        selectedModel: string | null;
      }>;
    };
    expect(campaignState.results).toHaveLength(6);
    expect(campaignState.results.every((row) => typeof row.key === "string" && row.key.length > 0)).toBe(true);
    expect(campaignState.results.every((row) => row.sampleId === "test-seed-42")).toBe(true);
    expect(campaignState.results.every((row) => Array.isArray(row.modelChain) && row.modelChain.length > 0)).toBe(true);
    expect(campaignState.results.every((row) => typeof row.selectedModel === "string" || row.selectedModel === null)).toBe(
      true
    );

    const logLines = (await fs.readFile(stubLog, "utf8"))
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as { group: string; noScaffold: boolean });

    expect(logLines).toHaveLength(6);
    const bareLogs = logLines.filter((line) => line.group === "bare");
    const scaffoldLogs = logLines.filter((line) => line.group === "scaffold");
    expect(bareLogs).toHaveLength(3);
    expect(scaffoldLogs).toHaveLength(3);
    expect(bareLogs.every((line) => line.noScaffold)).toBe(true);
    expect(scaffoldLogs.every((line) => !line.noScaffold)).toBe(true);
  }, 60_000);

  it("supports resume without re-running completed tasks", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-campaign-resume-"));
    const samplePath = path.join(tmp, "sample.json");
    const stubRunner = path.join(tmp, "stub-runner.mjs");
    const stubLog = path.join(tmp, "stub.log");
    const outputJson = path.join(tmp, "resume-results.json");
    const outputMd = path.join(tmp, "resume-results.md");

    await writeStubRunner(stubRunner);
    await fs.writeFile(stubLog, "", "utf8");

    const sample = {
      dataset: "SWE-bench/SWE-bench_Verified",
      split: "test",
      seed: 42,
      count: 2,
      sampleId: "resume-seed-42",
      instances: [
        { instance_id: "repo__issue-a", repo: "org/repo", stratum: "org/repo", instanceIndex: 1 },
        { instance_id: "repo__issue-b", repo: "org/repo", stratum: "org/repo", instanceIndex: 2 }
      ]
    };
    await fs.writeFile(samplePath, JSON.stringify(sample, null, 2), "utf8");

    const first = await runNode(
      [
        "scripts/run-swebench-campaign.mjs",
        "--sample", samplePath,
        "--group", "scaffold",
        "--concurrency", "1",
        "--timeout-ms", "20000",
        "--backend", "codex",
        "--model-chain", "gpt-5.2-codex,gpt-5.1-codex",
        "--output-json", outputJson,
        "--output-md", outputMd,
        "--runner", stubRunner
      ],
      ROOT,
      { STUB_LOG_PATH: stubLog }
    );

    const firstPayload = parseJsonFromMixed(first.stdout) as { campaignId: string };
    const beforeLines = (await fs.readFile(stubLog, "utf8")).split(/\r?\n/).filter((line) => line.trim().length > 0).length;
    expect(beforeLines).toBe(2);

    const second = await runNode(
      [
        "scripts/run-swebench-campaign.mjs",
        "--resume", firstPayload.campaignId,
        "--sample", samplePath,
        "--group", "scaffold",
        "--concurrency", "1",
        "--timeout-ms", "20000",
        "--backend", "codex",
        "--model-chain", "gpt-5.2-codex,gpt-5.1-codex",
        "--output-json", outputJson,
        "--output-md", outputMd,
        "--runner", stubRunner
      ],
      ROOT,
      { STUB_LOG_PATH: stubLog }
    );

    const secondPayload = parseJsonFromMixed(second.stdout) as { pendingBefore: number };
    const afterLines = (await fs.readFile(stubLog, "utf8")).split(/\r?\n/).filter((line) => line.trim().length > 0).length;

    expect(secondPayload.pendingBefore).toBe(0);
    expect(afterLines).toBe(beforeLines);
  }, 60_000);

  it("fails strict mode when model-attempted rate falls below threshold", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-campaign-strict-"));
    const samplePath = path.join(tmp, "sample.json");
    const stubRunner = path.join(tmp, "infra-stub-runner.mjs");
    const outputJson = path.join(tmp, "strict-results.json");
    const outputMd = path.join(tmp, "strict-results.md");
    await writeInfraBlockStubRunner(stubRunner);

    const sample = {
      dataset: "SWE-bench/SWE-bench_Verified",
      split: "test",
      seed: 42,
      count: 2,
      sampleId: "strict-seed-42",
      instances: [
        { instance_id: "repo__issue-a", repo: "org/repo", stratum: "org/repo", instanceIndex: 1 },
        { instance_id: "repo__issue-b", repo: "org/repo", stratum: "org/repo", instanceIndex: 2 }
      ]
    };
    await fs.writeFile(samplePath, JSON.stringify(sample, null, 2), "utf8");

    let strictError: any = null;
    try {
      await runNode([
        "scripts/run-swebench-campaign.mjs",
        "--sample", samplePath,
        "--group", "both",
        "--concurrency", "1",
        "--timeout-ms", "20000",
        "--backend", "codex",
        "--model-chain", "gpt-5.2-codex,gpt-5.1-codex",
        "--strict",
        "--strict-min-model-attempted-rate", "0.90",
        "--output-json", outputJson,
        "--output-md", outputMd,
        "--runner", stubRunner
      ]);
    } catch (error) {
      strictError = error;
    }

    expect(strictError).toBeTruthy();
    expect(String(strictError?.stderr || "")).toContain("strict gate failed");

    const strictPayload = parseJsonFromMixed(String(strictError.stderr)) as {
      strictFailures: string[];
      strictContext: { modelAttemptedRate: number; strictMinModelAttemptedRate: number };
    };
    expect(strictPayload.strictFailures.some((row) => row.includes("modelAttemptedRate"))).toBe(true);
    expect(strictPayload.strictContext.modelAttemptedRate).toBeCloseTo(0.5, 6);
    expect(strictPayload.strictContext.strictMinModelAttemptedRate).toBeCloseTo(0.9, 6);
  }, 60_000);

  it("locks runtime configuration to existing campaign state on resume", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-campaign-lock-"));
    const samplePath = path.join(tmp, "sample.json");
    const stubRunner = path.join(tmp, "stub-runner.mjs");
    const outputJson = path.join(tmp, "lock-results.json");
    const outputMd = path.join(tmp, "lock-results.md");

    await writeStubRunner(stubRunner);

    const sample = {
      dataset: "SWE-bench/SWE-bench_Verified",
      split: "test",
      seed: 42,
      count: 1,
      sampleId: "lock-seed-42",
      instances: [
        { instance_id: "repo__issue-a", repo: "org/repo", stratum: "org/repo", instanceIndex: 1 }
      ]
    };
    await fs.writeFile(samplePath, JSON.stringify(sample, null, 2), "utf8");

    const first = await runNode([
      "scripts/run-swebench-campaign.mjs",
      "--sample", samplePath,
      "--group", "scaffold",
      "--concurrency", "1",
      "--timeout-ms", "20000",
      "--backend", "codex",
      "--model-chain", "gpt-5.2-codex,gpt-5.1-codex",
      "--output-json", outputJson,
      "--output-md", outputMd,
      "--runner", stubRunner
    ]);

    const firstPayload = parseJsonFromMixed(first.stdout) as { campaignId: string };

    const resumed = await runNode([
      "scripts/run-swebench-campaign.mjs",
      "--resume", firstPayload.campaignId,
      "--sample", samplePath,
      "--group", "bare",
      "--concurrency", "16",
      "--timeout-ms", "10000",
      "--backend", "claude",
      "--model-chain", "claude-opus-4-6",
      "--output-json", outputJson,
      "--output-md", outputMd,
      "--runner", stubRunner
    ]);

    const resumedPayload = parseJsonFromMixed(resumed.stdout) as {
      resumeLockedConfig: boolean;
      groupMode: string;
      backend: string;
      concurrency: number;
      timeoutMs: number;
      modelChain: string[];
      pendingBefore: number;
    };

    expect(resumedPayload.resumeLockedConfig).toBe(true);
    expect(resumedPayload.groupMode).toBe("scaffold");
    expect(resumedPayload.backend).toBe("codex");
    expect(resumedPayload.concurrency).toBe(1);
    expect(resumedPayload.timeoutMs).toBe(20000);
    expect(resumedPayload.modelChain).toEqual(["gpt-5.2-codex", "gpt-5.1-codex"]);
    expect(resumedPayload.pendingBefore).toBe(0);
  }, 60_000);

  it("allows explicit resume overrides when --resume-override is set", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-campaign-override-"));
    const samplePath = path.join(tmp, "sample.json");
    const stubRunner = path.join(tmp, "stub-runner.mjs");
    const outputJson = path.join(tmp, "override-results.json");
    const outputMd = path.join(tmp, "override-results.md");

    await writeStubRunner(stubRunner);

    const sample = {
      dataset: "SWE-bench/SWE-bench_Verified",
      split: "test",
      seed: 42,
      count: 1,
      sampleId: "override-seed-42",
      instances: [
        { instance_id: "repo__issue-a", repo: "org/repo", stratum: "org/repo", instanceIndex: 1 }
      ]
    };
    await fs.writeFile(samplePath, JSON.stringify(sample, null, 2), "utf8");

    const first = await runNode([
      "scripts/run-swebench-campaign.mjs",
      "--sample", samplePath,
      "--group", "scaffold",
      "--concurrency", "1",
      "--timeout-ms", "20000",
      "--backend", "codex",
      "--model-chain", "gpt-5.2-codex,gpt-5.1-codex",
      "--output-json", outputJson,
      "--output-md", outputMd,
      "--runner", stubRunner
    ]);

    const firstPayload = parseJsonFromMixed(first.stdout) as { campaignId: string };

    const resumed = await runNode([
      "scripts/run-swebench-campaign.mjs",
      "--resume", firstPayload.campaignId,
      "--resume-override",
      "--sample", samplePath,
      "--group", "bare",
      "--concurrency", "4",
      "--timeout-ms", "10000",
      "--backend", "claude",
      "--model-chain", "claude-opus-4-6",
      "--output-json", outputJson,
      "--output-md", outputMd,
      "--runner", stubRunner
    ]);

    const resumedPayload = parseJsonFromMixed(resumed.stdout) as {
      resumeLockedConfig: boolean;
      resumeOverrideApplied: boolean;
      groupMode: string;
      backend: string;
      concurrency: number;
      timeoutMs: number;
      modelChain: string[];
      pendingBefore: number;
    };

    expect(resumedPayload.resumeLockedConfig).toBe(false);
    expect(resumedPayload.resumeOverrideApplied).toBe(true);
    expect(resumedPayload.groupMode).toBe("bare");
    expect(resumedPayload.backend).toBe("claude");
    expect(resumedPayload.concurrency).toBe(4);
    expect(resumedPayload.timeoutMs).toBe(10000);
    expect(resumedPayload.modelChain).toEqual(["claude-opus-4-6"]);
    expect(resumedPayload.pendingBefore).toBe(1);
  }, 60_000);

  it("computes McNemar statistics from campaign state", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-analyze-"));
    const campaignDir = path.join(tmp, "campaign");
    await fs.mkdir(campaignDir, { recursive: true });

    const state = {
      campaignId: "analyze-test",
      sampleId: "sample-test",
      sampleCount: 3,
      groupMode: "both",
      results: [
        { key: "scaffold:i1", instanceId: "i1", group: "scaffold", ok: true, status: "pass" },
        { key: "bare:i1", instanceId: "i1", group: "bare", ok: false, status: "fail" },
        { key: "scaffold:i2", instanceId: "i2", group: "scaffold", ok: false, status: "fail" },
        { key: "bare:i2", instanceId: "i2", group: "bare", ok: true, status: "pass" },
        { key: "scaffold:i3", instanceId: "i3", group: "scaffold", ok: true, status: "pass" },
        { key: "bare:i3", instanceId: "i3", group: "bare", ok: true, status: "pass" }
      ]
    };

    await fs.writeFile(path.join(campaignDir, "campaign.state.json"), JSON.stringify(state, null, 2), "utf8");

    const outputJson = path.join(tmp, "results.json");
    const outputMd = path.join(tmp, "results.md");

    const run = await runNode([
      "scripts/swebench-analyze.mjs",
      "--campaign", campaignDir,
      "--output-json", outputJson,
      "--output-md", outputMd
    ]);

    const payload = parseJsonFromMixed(run.stdout) as {
      ok: boolean;
      report: { mcnemar: { b: number; c: number; pValue: number }; wins: number; losses: number; ties: number };
    };

    expect(payload.ok).toBe(true);
    expect(payload.report.wins).toBe(1);
    expect(payload.report.losses).toBe(1);
    expect(payload.report.ties).toBe(1);
    expect(payload.report.mcnemar.b).toBe(1);
    expect(payload.report.mcnemar.c).toBe(1);
    expect(payload.report.mcnemar.pValue).toBeCloseTo(1, 6);

    const [jsonExists, mdExists] = await Promise.all([
      fs.access(outputJson).then(() => true).catch(() => false),
      fs.access(outputMd).then(() => true).catch(() => false)
    ]);
    expect(jsonExists).toBe(true);
    expect(mdExists).toBe(true);
  });
});
