import fs from "node:fs/promises";
import path from "node:path";

export const SALACIA_DIR = ".salacia";
const RUNS_DIR_NAME = "runs";

export interface SalaciaPaths {
  root: string;
  salacia: string;
  contracts: string;
  specs: string;
  plans: string;
  journal: string;
  snapshots: string;
  progress: string;
}

export interface RunPaths {
  root: string;
  runId: string;
  dir: string;
  intentIr: string;
  plan: string;
  executionDir: string;
  session: string;
  verificationDir: string;
  verifyReport: string;
  convergenceDir: string;
  convergePlan: string;
  convergeExec: string;
}

function runsRoot(root: string): string {
  return path.join(getSalaciaPaths(root).journal, RUNS_DIR_NAME);
}

export function createRunId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getRunPaths(root: string, runId: string): RunPaths {
  const dir = path.join(runsRoot(root), runId);
  const executionDir = path.join(dir, "execution");
  const verificationDir = path.join(dir, "verify");
  const convergenceDir = path.join(dir, "converge");
  return {
    root,
    runId,
    dir,
    intentIr: path.join(dir, "intent.ir.json"),
    plan: path.join(dir, "plan.json"),
    executionDir,
    session: path.join(executionDir, "session.json"),
    verificationDir,
    verifyReport: path.join(verificationDir, "report.json"),
    convergenceDir,
    convergePlan: path.join(convergenceDir, "plan.json"),
    convergeExec: path.join(convergenceDir, "exec.json")
  };
}

export async function ensureRunDirs(root: string, runId: string): Promise<RunPaths> {
  const run = getRunPaths(root, runId);
  await fs.mkdir(run.dir, { recursive: true });
  await fs.mkdir(run.executionDir, { recursive: true });
  await fs.mkdir(run.verificationDir, { recursive: true });
  await fs.mkdir(run.convergenceDir, { recursive: true });
  return run;
}

export async function resolveLatestRunId(root: string): Promise<string | null> {
  const rootDir = runsRoot(root);
  const ids = await fs.readdir(rootDir).catch(() => []);
  if (ids.length === 0) return null;

  const ranked = await Promise.all(
    ids.map(async (runId) => {
      const run = getRunPaths(root, runId);
      const stat = await fs
        .stat(run.intentIr)
        .catch(() => fs.stat(run.dir))
        .catch(() => null);
      if (!stat) return null;
      return { runId, mtimeMs: stat.mtimeMs };
    })
  );

  const filtered = ranked.filter((item): item is { runId: string; mtimeMs: number } => item !== null);
  if (filtered.length === 0) return null;
  filtered.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return filtered[0]?.runId ?? null;
}

export function getSalaciaPaths(root = process.cwd()): SalaciaPaths {
  const salacia = path.join(root, SALACIA_DIR);
  return {
    root,
    salacia,
    contracts: path.join(salacia, "contracts"),
    specs: path.join(salacia, "specs"),
    plans: path.join(salacia, "plans"),
    journal: path.join(salacia, "journal"),
    snapshots: path.join(salacia, "snapshots"),
    progress: path.join(salacia, "progress")
  };
}

export async function ensureSalaciaDirs(root = process.cwd()): Promise<SalaciaPaths> {
  const paths = getSalaciaPaths(root);
  await fs.mkdir(paths.salacia, { recursive: true });
  await fs.mkdir(paths.contracts, { recursive: true });
  await fs.mkdir(paths.specs, { recursive: true });
  await fs.mkdir(paths.plans, { recursive: true });
  await fs.mkdir(paths.journal, { recursive: true });
  await fs.mkdir(paths.snapshots, { recursive: true });
  await fs.mkdir(paths.progress, { recursive: true });
  return paths;
}

export async function latestFileInDir(dir: string, extension: string): Promise<string | null> {
  const files = await fs.readdir(dir).catch(() => []);
  const filtered = files.filter((f) => f.endsWith(extension));
  if (filtered.length === 0) {
    return null;
  }

  const withStats = await Promise.all(
    filtered.map(async (f) => {
      const full = path.join(dir, f);
      const st = await fs.stat(full);
      return { full, mtime: st.mtimeMs };
    })
  );

  withStats.sort((a, b) => b.mtime - a.mtime);
  return withStats[0]?.full ?? null;
}
