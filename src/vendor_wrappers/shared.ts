import fs from "node:fs/promises";
import path from "node:path";
import type { VendorMirrorInfo, VendorWrapperHealth } from "./types.js";

export async function loadMirrorInfo(cwd: string, targetDir: string): Promise<VendorMirrorInfo | null> {
  const sourcePath = path.join(cwd, targetDir, ".source.json");
  try {
    const raw = await fs.readFile(sourcePath, "utf8");
    return JSON.parse(raw) as VendorMirrorInfo;
  } catch {
    return null;
  }
}

export async function checkMirrorHealth(
  cwd: string,
  vendor: string,
  targetDir: string,
  expectedRepo: string
): Promise<VendorWrapperHealth> {
  const source = await loadMirrorInfo(cwd, targetDir);
  if (!source) {
    return {
      ok: false,
      vendor,
      details: `Mirror metadata missing at ${path.join(targetDir, ".source.json")}`
    };
  }

  const repoMatches = source.repo === expectedRepo;
  return {
    ok: repoMatches,
    vendor,
    details: repoMatches ? `Mirror pinned at ${source.commit}` : `Mirror repo mismatch (${source.repo})`,
    source
  };
}
