import fs from "node:fs/promises";
import path from "node:path";

export type CleanMode = "safe" | "bench" | "full";

export interface CleanWorkspaceOptions {
  mode?: CleanMode;
  dryRun?: boolean;
  keep?: number;
}

export interface CleanWorkspaceEntry {
  path: string;
  bytes: number;
  reason: string;
}

export interface CleanWorkspaceReport {
  mode: CleanMode;
  dryRun: boolean;
  keep: number;
  removedCount: number;
  freedBytes: number;
  removed: CleanWorkspaceEntry[];
  skipped: string[];
}

interface RankedEntry {
  fullPath: string;
  mtimeMs: number;
}

async function pathExists(target: string): Promise<boolean> {
  return fs
    .access(target)
    .then(() => true)
    .catch(() => false);
}

async function fileSizeRecursive(target: string): Promise<number> {
  const stat = await fs.stat(target).catch(() => null);
  if (!stat) return 0;
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;

  let total = 0;
  const stack = [target];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.isFile()) {
        const itemStat = await fs.stat(full).catch(() => null);
        total += itemStat?.size ?? 0;
      }
    }
  }
  return total;
}

async function removePath(
  fullPath: string,
  reason: string,
  dryRun: boolean,
  report: CleanWorkspaceReport
): Promise<void> {
  const exists = await pathExists(fullPath);
  if (!exists) {
    report.skipped.push(`${reason}: ${fullPath} (missing)`);
    return;
  }

  const bytes = await fileSizeRecursive(fullPath);
  if (!dryRun) {
    await fs.rm(fullPath, { recursive: true, force: true });
  }

  report.removed.push({
    path: fullPath,
    bytes,
    reason
  });
}

async function rankedChildren(dirPath: string): Promise<RankedEntry[]> {
  const entries = await fs.readdir(dirPath).catch(() => []);
  const ranked = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dirPath, entry);
      const stat = await fs.stat(fullPath).catch(() => null);
      if (!stat) return null;
      return {
        fullPath,
        mtimeMs: stat.mtimeMs
      };
    })
  );
  return ranked
    .filter((item): item is RankedEntry => item !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

async function pruneOlderEntries(
  dirPath: string,
  keep: number,
  reason: string,
  dryRun: boolean,
  report: CleanWorkspaceReport
): Promise<void> {
  if (!(await pathExists(dirPath))) {
    report.skipped.push(`${reason}: ${dirPath} (missing)`);
    return;
  }

  const ranked = await rankedChildren(dirPath);
  const stale = ranked.slice(Math.max(0, keep));
  for (const item of stale) {
    await removePath(item.fullPath, reason, dryRun, report);
  }
}

async function removeRootLogs(cwd: string, dryRun: boolean, report: CleanWorkspaceReport): Promise<void> {
  const rootEntries = await fs.readdir(cwd).catch(() => []);
  for (const entry of rootEntries) {
    if (/^gold\.salacia-public-swebench-lite-.*\.json$/i.test(entry)) {
      await removePath(path.join(cwd, entry), "safe:public-bench-output", dryRun, report);
      continue;
    }
    if (/\.log$/i.test(entry)) {
      await removePath(path.join(cwd, entry), "safe:root-log", dryRun, report);
    }
  }
}

async function safeCleanup(cwd: string, dryRun: boolean, report: CleanWorkspaceReport): Promise<void> {
  const safeTargets = [
    { rel: "dist", reason: "safe:build-artifacts" },
    { rel: "coverage", reason: "safe:test-coverage" },
    { rel: "logs", reason: "safe:runtime-logs" },
    { rel: ".tsup", reason: "safe:bundler-cache" },
    { rel: ".vitest", reason: "safe:test-cache" }
  ];

  for (const target of safeTargets) {
    await removePath(path.join(cwd, target.rel), target.reason, dryRun, report);
  }

  await removeRootLogs(cwd, dryRun, report);
}

async function benchCleanup(cwd: string, keep: number, dryRun: boolean, report: CleanWorkspaceReport): Promise<void> {
  const runsRoot = path.join(cwd, ".salacia", "journal", "bench", "runs");
  await pruneOlderEntries(runsRoot, keep, "bench:runs-rotation", dryRun, report);

  const publicRoot = path.join(cwd, ".salacia", "journal", "bench", "public");
  if (await pathExists(publicRoot)) {
    const suites = await fs.readdir(publicRoot).catch(() => []);
    for (const suite of suites) {
      await pruneOlderEntries(
        path.join(publicRoot, suite),
        keep,
        `bench:public-${suite}-rotation`,
        dryRun,
        report
      );
    }
  } else {
    report.skipped.push(`bench:public-runs: ${publicRoot} (missing)`);
  }

  const journalRoot = path.join(cwd, ".salacia", "journal");
  if (await pathExists(journalRoot)) {
    const entries = await fs.readdir(journalRoot).catch(() => []);
    const releaseGateFiles = entries.filter((entry) => /^release-gate-\d+\.json$/.test(entry));
    const superiorityFiles = entries.filter((entry) => /^superiority-audit-\d+\.json$/.test(entry));

    for (const group of [releaseGateFiles, superiorityFiles]) {
      const ranked = (
        await Promise.all(
          group.map(async (entry) => {
            const fullPath = path.join(journalRoot, entry);
            const stat = await fs.stat(fullPath).catch(() => null);
            return stat ? { fullPath, mtimeMs: stat.mtimeMs } : null;
          })
        )
      )
        .filter((item): item is RankedEntry => item !== null)
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      for (const stale of ranked.slice(Math.max(0, keep))) {
        await removePath(stale.fullPath, "bench:journal-rotation", dryRun, report);
      }
    }
  }
}

async function fullCleanup(cwd: string, keep: number, dryRun: boolean, report: CleanWorkspaceReport): Promise<void> {
  const plansRoot = path.join(cwd, ".salacia", "plans");
  if (await pathExists(plansRoot)) {
    const entries = await fs.readdir(plansRoot).catch(() => []);
    const intentFiles = entries.filter((entry) => /^intent-ir-\d+(?:-[a-f0-9]{8})?\.json$/.test(entry));
    const ranked = (
      await Promise.all(
        intentFiles.map(async (entry) => {
          const fullPath = path.join(plansRoot, entry);
          const stat = await fs.stat(fullPath).catch(() => null);
          return stat ? { fullPath, mtimeMs: stat.mtimeMs } : null;
        })
      )
    )
      .filter((item): item is RankedEntry => item !== null)
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const stale of ranked.slice(Math.max(0, keep))) {
      await removePath(stale.fullPath, "full:intent-ir-rotation", dryRun, report);
    }
  } else {
    report.skipped.push(`full:intent-ir: ${plansRoot} (missing)`);
  }
}

export async function cleanWorkspace(cwd: string, options: CleanWorkspaceOptions = {}): Promise<CleanWorkspaceReport> {
  const mode = options.mode ?? "safe";
  const dryRun = options.dryRun ?? false;
  const keep = Math.max(1, Math.floor(options.keep ?? 5));
  const report: CleanWorkspaceReport = {
    mode,
    dryRun,
    keep,
    removedCount: 0,
    freedBytes: 0,
    removed: [],
    skipped: []
  };

  await safeCleanup(cwd, dryRun, report);
  if (mode === "bench" || mode === "full") {
    await benchCleanup(cwd, keep, dryRun, report);
  }
  if (mode === "full") {
    await fullCleanup(cwd, keep, dryRun, report);
  }

  report.removedCount = report.removed.length;
  report.freedBytes = report.removed.reduce((sum, item) => sum + item.bytes, 0);
  return report;
}
