import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createRunId, ensureRunDirs, getRunPaths, resolveLatestRunId } from "../src/core/paths.js";

describe("run paths", () => {
  it("creates deterministic run artifact directories", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-run-paths-"));
    const runId = createRunId();
    const run = await ensureRunDirs(root, runId);
    const stat = await fs.stat(run.dir);
    expect(stat.isDirectory()).toBe(true);
    expect(run.intentIr.endsWith("intent.ir.json")).toBe(true);
    expect(run.verifyReport.endsWith(path.join("verify", "report.json"))).toBe(true);
  });

  it("resolves latest run id by mtime", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-run-latest-"));
    const runA = "run-a";
    const runB = "run-b";
    await ensureRunDirs(root, runA);
    const pathA = getRunPaths(root, runA);
    await fs.writeFile(pathA.intentIr, "{}", "utf8");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await ensureRunDirs(root, runB);
    const pathB = getRunPaths(root, runB);
    await fs.writeFile(pathB.intentIr, "{}", "utf8");

    const latest = await resolveLatestRunId(root);
    expect(latest).toBe(runB);
  });
});
