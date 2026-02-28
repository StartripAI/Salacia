import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();

type CampaignRow = {
  key: string;
  instanceId: string;
  instanceIndex: number;
  group: "scaffold" | "bare";
  status: string;
  ok: boolean;
  reason: string;
  result?: Record<string, unknown>;
};

describe("swebench analyze", () => {
  it("produces strict four-bucket failure breakdown with priority ordering", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-analyze-"));
    const campaignDir = path.join(tmp, "campaign");
    await fs.mkdir(campaignDir, { recursive: true });

    const rows: CampaignRow[] = [
      {
        key: "scaffold:ok-1",
        instanceId: "ok-1",
        instanceIndex: 1,
        group: "scaffold",
        status: "pass",
        ok: true,
        reason: "stub-pass"
      },
      {
        key: "scaffold:contract-1",
        instanceId: "contract-1",
        instanceIndex: 2,
        group: "scaffold",
        status: "fail",
        ok: false,
        reason: "contract-block",
        result: {
          metrics: {
            failureCategory: "contract-block",
            contractValidation: { ok: false }
          }
        }
      },
      {
        key: "bare:rollback-1",
        instanceId: "rollback-1",
        instanceIndex: 3,
        group: "bare",
        status: "fail",
        ok: false,
        reason: "rollback-integrity-fail",
        result: {
          metrics: {
            rollback: { failed: 1 }
          }
        }
      },
      {
        key: "scaffold:eval-1",
        instanceId: "eval-1",
        instanceIndex: 4,
        group: "scaffold",
        status: "fail",
        ok: false,
        reason: "real single-instance evaluation finished (resolved=0, unresolved=1, errors=0)"
      },
      {
        key: "bare:model-1",
        instanceId: "model-1",
        instanceIndex: 5,
        group: "bare",
        status: "fail",
        ok: false,
        reason: "codex backend failed: usage limit"
      },
      {
        key: "bare:infra-1",
        instanceId: "infra-1",
        instanceIndex: 6,
        group: "bare",
        status: "blocked",
        ok: false,
        reason: "docker daemon unavailable: Command failed: docker info"
      },
      {
        key: "scaffold:priority-1",
        instanceId: "priority-1",
        instanceIndex: 7,
        group: "scaffold",
        status: "fail",
        ok: false,
        reason: "swebench evaluation failed: command failed",
        result: {
          metrics: {
            failureCategory: "contract-block",
            contractValidation: { ok: false }
          }
        }
      }
    ];

    const state = {
      campaignId: "analyze-fixture",
      sampleId: "fixture-seed",
      groupMode: "both",
      sampleCount: 3,
      tasksTotal: rows.length,
      completedKeys: rows.map((row) => row.key),
      results: rows
    };

    await fs.writeFile(path.join(campaignDir, "campaign.state.json"), JSON.stringify(state, null, 2), "utf8");

    const outputJson = path.join(tmp, "report.json");
    const outputMd = path.join(tmp, "report.md");
    await execFileAsync(
      "node",
      [
        "scripts/swebench-analyze.mjs",
        "--campaign",
        campaignDir,
        "--output-json",
        outputJson,
        "--output-md",
        outputMd
      ],
      {
        cwd: ROOT,
        maxBuffer: 16 * 1024 * 1024
      }
    );

    const report = JSON.parse(await fs.readFile(outputJson, "utf8"));
    expect(report.failureBreakdown.overall.totalFail).toBe(6);
    expect(report.failureBreakdown.overall.buckets["contract-block"]).toBe(2);
    expect(report.failureBreakdown.overall.buckets["rollback-fail"]).toBe(1);
    expect(report.failureBreakdown.overall.buckets["eval-fail"]).toBe(1);
    expect(report.failureBreakdown.overall.buckets["model-fail"]).toBe(0);
    expect(report.failureBreakdown.overall.buckets["infra-block"]).toBe(2);
    expect(report.executionContext.totalRuns).toBe(7);
    expect(report.executionContext.infraBlockedRuns).toBe(2);
    expect(report.executionContext.modelAttemptedRuns).toBe(5);
    expect(report.executionContext.modelAttemptedFailures).toBe(4);
    expect(report.executionContext.modelAttemptedPasses).toBe(1);

    expect(report.failureBreakdown.byGroup.scaffold.buckets["contract-block"]).toBe(2);
    expect(report.failureBreakdown.byGroup.scaffold.buckets["eval-fail"]).toBe(1);
    expect(report.failureBreakdown.byGroup.bare.buckets["rollback-fail"]).toBe(1);
    expect(report.failureBreakdown.byGroup.bare.buckets["model-fail"]).toBe(0);
    expect(report.failureBreakdown.byGroup.bare.buckets["infra-block"]).toBe(2);

    const rawReasons = report.failureBreakdown.overall.rawReasonCounts;
    expect(Array.isArray(rawReasons)).toBe(true);
    expect(rawReasons.some((row: { reason: string }) => row.reason === "contract-block")).toBe(true);

    const markdown = await fs.readFile(outputMd, "utf8");
    expect(markdown).toContain("# SWE-bench 7 Paired Result");
    expect(markdown).toContain("## Execution Context");
    expect(markdown).toContain("Infra-blocked runs");
    expect(markdown).toContain("## Failure Breakdown");
    expect(markdown).toContain("contract-block");
    expect(markdown).toContain("rollback-fail");
    expect(markdown).toContain("eval-fail");
    expect(markdown).toContain("model-fail");
    expect(markdown).toContain("infra-block");
  });
});
