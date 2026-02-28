import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
// @ts-expect-error local ESM helper without ambient typings
import * as snapshotModule from "../scripts/benchmark-snapshot.mjs";

const { createBenchmarkSnapshot, restoreBenchmarkSnapshot, runSnapshotStatusCheck } = snapshotModule as {
  createBenchmarkSnapshot: (repoPath: string, snapshotPath: string, options?: Record<string, unknown>) => Promise<any>;
  restoreBenchmarkSnapshot: (repoPath: string, snapshotPath: string) => Promise<any>;
  runSnapshotStatusCheck: (repoPath: string) => Promise<any>;
};

const execFileAsync = promisify(execFile);

async function runGit(repoPath: string, args: string[]) {
  const { stdout, stderr } = await execFileAsync("git", args, {
    cwd: repoPath,
    maxBuffer: 16 * 1024 * 1024
  });
  return `${stdout}\n${stderr}`.trim();
}

async function initRepo(): Promise<string> {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-bench-snapshot-"));
  await runGit(repoPath, ["init"]);
  await runGit(repoPath, ["config", "user.email", "snapshot@example.com"]);
  await runGit(repoPath, ["config", "user.name", "Snapshot Test"]);
  await fs.writeFile(path.join(repoPath, "app.txt"), "hello\n", "utf8");
  await runGit(repoPath, ["add", "."]);
  await runGit(repoPath, ["commit", "-m", "seed"]);
  return repoPath;
}

describe("benchmark snapshot lifecycle", () => {
  it("captures and restores workspace state with checksum verification", async () => {
    const repoPath = await initRepo();
    const snapshotDir = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-bench-snapshot-file-"));
    const snapshotPath = path.join(snapshotDir, "snapshot.pre.json");

    await fs.writeFile(path.join(repoPath, "app.txt"), "hello\npatched\n", "utf8");
    await fs.writeFile(path.join(repoPath, "notes.txt"), "temporary note\n", "utf8");

    const snapshot = await createBenchmarkSnapshot(repoPath, snapshotPath, { label: "pre" });
    expect(snapshot.ok).toBe(true);
    expect((snapshot.snapshot?.untrackedFiles || []).some((file: { path: string }) => file.path === "notes.txt")).toBe(
      true
    );

    await fs.writeFile(path.join(repoPath, "app.txt"), "BROKEN\n", "utf8");
    await fs.rm(path.join(repoPath, "notes.txt"), { force: true });
    await fs.writeFile(path.join(repoPath, "other.txt"), "garbage\n", "utf8");

    const restored = await restoreBenchmarkSnapshot(repoPath, snapshotPath);
    expect(restored.ok).toBe(true);

    const app = await fs.readFile(path.join(repoPath, "app.txt"), "utf8");
    const note = await fs.readFile(path.join(repoPath, "notes.txt"), "utf8");
    expect(app).toBe("hello\npatched\n");
    expect(note).toBe("temporary note\n");

    const statusCheck = await runSnapshotStatusCheck(repoPath);
    expect(statusCheck.ok).toBe(true);

    const statusNow = await runGit(repoPath, ["status", "--porcelain=v1", "--untracked-files=all"]);
    expect(statusNow).toBe(String(snapshot.snapshot?.status || "").trim());
  });

  it("fails restore when snapshot checksum is tampered", async () => {
    const repoPath = await initRepo();
    const snapshotDir = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-bench-snapshot-file-"));
    const snapshotPath = path.join(snapshotDir, "snapshot.pre.json");

    await fs.writeFile(path.join(repoPath, "app.txt"), "hello\npatched\n", "utf8");
    const snapshot = await createBenchmarkSnapshot(repoPath, snapshotPath, { label: "pre" });
    expect(snapshot.ok).toBe(true);

    const tampered = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
    tampered.workingPatch = "diff --git a/app.txt b/app.txt\n";
    await fs.writeFile(snapshotPath, JSON.stringify(tampered, null, 2), "utf8");

    const restored = await restoreBenchmarkSnapshot(repoPath, snapshotPath);
    expect(restored.ok).toBe(false);
    expect(String(restored.reason)).toContain("checksum");
  });
});
