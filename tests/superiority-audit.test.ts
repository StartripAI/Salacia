import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runSuperiorityAudit } from "../src/audit/superiority.js";

describe("superiority audit", () => {
  it("passes the default Trellis baseline profile with auditable evidence", async () => {
    const report = await runSuperiorityAudit({ cwd: process.cwd() });
    expect(report.strongerThanBaseline).toBe(true);
    expect(report.score).toBeGreaterThanOrEqual(report.requiredScore);
    expect(report.checks.length).toBeGreaterThan(0);
    expect(report.requiredFailures.length).toBe(0);
    expect(report.reportPath).toContain(".salacia/journal/superiority-audit-");
  });

  it("fails when an impossible profile threshold is supplied", async () => {
    const strictProfile = {
      id: "strict-baseline",
      name: "Strict baseline",
      version: "1.0.0",
      baselineScore: 95,
      requiredScore: 1000,
      requiredMargin: 10,
      minimumStrengthSignals: 10,
      checks: [
        {
          id: "prompt.compiler.pipeline",
          probe: "prompt_compiler_pipeline",
          weight: 5,
          required: true,
          strengthSignal: true
        }
      ]
    };

    const profilePath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "salacia-audit-profile-")), "strict.json");
    await fs.writeFile(profilePath, JSON.stringify(strictProfile, null, 2), "utf8");

    const report = await runSuperiorityAudit({
      cwd: process.cwd(),
      profilePath
    });

    expect(report.strongerThanBaseline).toBe(false);
  });
});
