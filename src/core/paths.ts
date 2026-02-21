import fs from "node:fs/promises";
import path from "node:path";

export const SALACIA_DIR = ".salacia";

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
