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
  const { stdout } = await execFileAsync("git", ["diff", "--name-only"], { cwd }).catch(() => ({ stdout: "" }));
  return stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function matchesPrefix(file: string, rules: string[]): boolean {
  return rules.some((rule) => {
    const normalized = rule.replace("/**", "").replace("*", "");
    return normalized ? file.startsWith(normalized) : false;
  });
}

export async function detectDrift(contract: Contract, cwd = process.cwd()): Promise<DriftResult> {
  const files = await changedFiles(cwd);
  const outOfScopeChanges = files.filter((f) => !matchesPrefix(f, contract.scope.inScope));
  const protectedPathTouches = files.filter((f) => matchesPrefix(f, contract.guardrails.protectedPaths));

  let score = 0;
  score += outOfScopeChanges.length * 20;
  score += protectedPathTouches.length * 40;
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
