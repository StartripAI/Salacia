import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cleanWorkspace } from "../src/core/clean.js";

async function touch(filePath: string, content = "x"): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

describe("workspace clean", () => {
  it("safe mode supports dry-run without deleting files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-clean-safe-dry-"));
    await touch(path.join(root, "dist", "index.js"), "console.log('x');");

    const report = await cleanWorkspace(root, { mode: "safe", dryRun: true });
    const stillThere = await fs
      .access(path.join(root, "dist", "index.js"))
      .then(() => true)
      .catch(() => false);

    expect(report.mode).toBe("safe");
    expect(report.dryRun).toBe(true);
    expect(report.removedCount).toBeGreaterThanOrEqual(1);
    expect(stillThere).toBe(true);
  });

  it("safe mode removes generated artifacts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-clean-safe-"));
    await touch(path.join(root, "dist", "bundle.js"), "bundle");
    await touch(path.join(root, "coverage", "summary.txt"), "coverage");
    await touch(path.join(root, "build.log"), "log");

    const report = await cleanWorkspace(root, { mode: "safe", dryRun: false });
    const distExists = await fs
      .access(path.join(root, "dist"))
      .then(() => true)
      .catch(() => false);
    const logExists = await fs
      .access(path.join(root, "build.log"))
      .then(() => true)
      .catch(() => false);

    expect(report.removedCount).toBeGreaterThanOrEqual(2);
    expect(report.freedBytes).toBeGreaterThan(0);
    expect(distExists).toBe(false);
    expect(logExists).toBe(false);
  });

  it("bench mode rotates old benchmark runs and keeps newest entries", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-clean-bench-"));
    const runsRoot = path.join(root, ".salacia", "journal", "bench", "runs");
    await fs.mkdir(runsRoot, { recursive: true });

    const runDirs = ["run-1", "run-2", "run-3"];
    for (let i = 0; i < runDirs.length; i += 1) {
      const dir = path.join(runsRoot, runDirs[i] as string);
      await touch(path.join(dir, "report.json"), "{}");
      const ts = Date.now() - (runDirs.length - i) * 1000;
      await fs.utimes(dir, ts / 1000, ts / 1000);
    }

    const report = await cleanWorkspace(root, { mode: "bench", keep: 1 });
    const remaining = await fs.readdir(runsRoot).catch(() => []);

    expect(report.mode).toBe("bench");
    expect(remaining.length).toBe(1);
    expect(report.removedCount).toBeGreaterThanOrEqual(2);
  });
});
