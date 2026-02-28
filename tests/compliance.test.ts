import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

async function runJsonScript(script: string) {
  const { stdout } = await execFileAsync("node", [script], {
    cwd: process.cwd(),
    maxBuffer: 10 * 1024 * 1024
  });
  return JSON.parse(stdout);
}

describe("compliance audits", () => {
  it("passes license audit checks", async () => {
    const report = await runJsonScript("scripts/license-audit.mjs");
    expect(report.ok).toBe(true);
    expect(report.failures.length).toBe(0);
  });

  it("passes vendor integrity audit checks", async () => {
    const report = await runJsonScript("scripts/vendor-integrity-audit.mjs");
    expect(report.ok).toBe(true);
    expect(report.failedCount).toBe(0);
  }, 60_000);

  it("manifest includes three mirrored apache vendors", async () => {
    const report = await runJsonScript("scripts/vendor-integrity-audit.mjs");
    expect(report.checks.length).toBe(3);
    expect(report.checks.map((row: { name: string }) => row.name)).toEqual(["aider", "cline", "continue"]);
  }, 60_000);
});
