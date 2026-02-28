import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Contract } from "../core/types.js";

const execFileAsync = promisify(execFile);

export interface DriftResult {
  score: number;
  severity: "none" | "low" | "medium" | "high";
  thresholds: {
    low: number;
    medium: number;
    high: number;
  };
  changedFiles: string[];
  outOfScopeChanges: string[];
  protectedPathTouches: string[];
}

async function changedFiles(cwd: string): Promise<string[]> {
  const [unstaged, staged, untracked] = await Promise.all([
    execFileAsync("git", ["diff", "--name-only"], { cwd }).catch(() => ({ stdout: "" })),
    execFileAsync("git", ["diff", "--cached", "--name-only"], { cwd }).catch(() => ({ stdout: "" })),
    execFileAsync("git", ["ls-files", "--others", "--exclude-standard"], { cwd }).catch(() => ({ stdout: "" }))
  ]);

  const files = `${unstaged.stdout}\n${staged.stdout}\n${untracked.stdout}`
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  return Array.from(new Set(files));
}

function matchesPrefix(file: string, rules: string[]): boolean {
  return rules.some((rule) => {
    // Strip trailing glob suffix to get the directory prefix
    const normalized = rule
      .replace(/\/\*\*.*$/, "")
      .replace(/\/\*$/, "")
      .replace(/\*$/, "")
      .replace(/\/+$/, "");
    if (!normalized) return false;
    // Require exact segment boundary: prefix must be followed by "/" or be exact match
    return file === normalized || file.startsWith(normalized + "/");
  });
}

export async function detectDrift(contract: Contract, cwd = process.cwd()): Promise<DriftResult> {
  const files = await changedFiles(cwd);
  const outOfScopeChanges = files.filter((f) => !matchesPrefix(f, contract.scope.inScope));
  const protectedPathTouches = files.filter((f) => matchesPrefix(f, contract.guardrails.protectedPaths));

  let score = 0;
  score += files.length * 5;
  score += outOfScopeChanges.length * 20;
  score += protectedPathTouches.length * 40;
  if (protectedPathTouches.length > 0) {
    score = Math.max(score, 60);
  }
  const thresholds = { low: 20, medium: 60, high: 100 };
  let severity: DriftResult["severity"] = "none";
  if (score >= thresholds.high) {
    severity = "high";
  } else if (score >= thresholds.medium) {
    severity = "medium";
  } else if (score >= thresholds.low) {
    severity = "low";
  }

  return {
    score,
    severity,
    thresholds,
    changedFiles: files,
    outOfScopeChanges,
    protectedPathTouches
  };
}
