import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  Blueprint,
  JudgeDecision,
  JudgeIssue,
  JudgeReport,
  PromotionDecision,
  VerificationSummary
} from "../core/types.js";

const execFileAsync = promisify(execFile);

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function globToRegExp(glob: string): RegExp {
  let source = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index] ?? "";
    const next = glob[index + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      continue;
    }
    if (char === "?") {
      source += ".";
      continue;
    }
    source += /[\\^$+?.()|[\]{}]/.test(char) ? `\\${char}` : char;
  }
  source += "$";
  return new RegExp(source);
}

function matchesAny(file: string, patterns: string[]): boolean {
  const normalized = normalizePath(file);
  return patterns.some((pattern) => globToRegExp(normalizePath(pattern)).test(normalized));
}

export async function collectChangedFiles(workspacePath: string): Promise<string[]> {
  try {
    await execFileAsync("git", ["add", "-N", "--", "."], {
      cwd: workspacePath,
      timeout: 20_000,
      maxBuffer: 8 * 1024 * 1024
    });
  } catch {
    // best effort only
  }

  try {
    const { stdout } = await execFileAsync("git", ["diff", "--name-only", "--", "."], {
      cwd: workspacePath,
      timeout: 20_000,
      maxBuffer: 8 * 1024 * 1024
    });
    return String(stdout || "")
      .split(/\r?\n/g)
      .map((line) => normalizePath(line.trim()))
      .filter(Boolean)
      .filter((file) => !file.startsWith(".salacia/") && !file.startsWith(".git/"));
  } catch {
    return [];
  }
}

export async function writeCandidatePatch(workspacePath: string, targetPath: string): Promise<string | null> {
  try {
    await execFileAsync("git", ["add", "-N", "--", "."], {
      cwd: workspacePath,
      timeout: 20_000,
      maxBuffer: 8 * 1024 * 1024
    });
  } catch {
    // best effort only
  }

  try {
    const { stdout } = await execFileAsync("git", ["diff", "--binary", "--", "."], {
      cwd: workspacePath,
      timeout: 20_000,
      maxBuffer: 8 * 1024 * 1024
    });
    const patch = String(stdout || "");
    if (!patch.trim()) {
      return null;
    }
    await fs.writeFile(targetPath, patch, "utf8");
    return targetPath;
  } catch {
    return null;
  }
}

export async function judgeRun(options: {
  runId: string;
  blueprint: Blueprint;
  adapter: string;
  workspaceMode: "worktree" | "root";
  programPath: string;
  contextPath: string;
  changedFiles: string[];
  verification: VerificationSummary;
  executionSuccess: boolean;
  evidenceRefs: string[];
}): Promise<JudgeReport> {
  const issues: JudgeIssue[] = [];

  for (const file of options.changedFiles) {
    if (matchesAny(file, options.blueprint.protectedSurface)) {
      issues.push({
        code: "protected-path",
        file,
        message: `Changed file touches protected surface: ${file}`
      });
      continue;
    }
    if (!matchesAny(file, options.blueprint.mutableSurface)) {
      issues.push({
        code: "out-of-scope-write",
        file,
        message: `Changed file escaped mutable surface: ${file}`
      });
    }
  }

  if (!options.executionSuccess) {
    issues.push({
      code: "adapter-failed",
      message: "Adapter execution failed before promotion."
    });
  }

  if (!options.verification.success) {
    issues.push({
      code: "verification-failed",
      message: "Verification commands did not pass."
    });
  }

  let judgeDecision: JudgeDecision = "accept";
  if (issues.some((issue) => issue.code === "protected-path" || issue.code === "out-of-scope-write")) {
    judgeDecision = "blocked";
  } else if (issues.some((issue) => issue.code === "verification-failed" || issue.code === "adapter-failed")) {
    judgeDecision = "reject";
  }

  const promotionDecision: PromotionDecision = judgeDecision;
  const score = judgeDecision === "accept" ? 10 : judgeDecision === "reject" ? 4 : 0;

  return {
    generatedAt: new Date().toISOString(),
    runId: options.runId,
    blueprintId: options.blueprint.id,
    inputs: {
      programPath: options.programPath,
      adapter: options.adapter,
      workspaceMode: options.workspaceMode
    },
    budget: options.blueprint.budget,
    contextEvidence: {
      contextPath: options.contextPath,
      repoMapFiles: [],
      workingSetFiles: [],
      historyEntries: 0
    },
    verificationResults: options.verification,
    changedFiles: options.changedFiles,
    issues,
    score,
    judgeDecision,
    promotionDecision,
    evidenceRefs: Array.from(new Set(options.evidenceRefs))
  };
}

export async function applyCandidatePatch(root: string, patchPath: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await execFileAsync("git", ["apply", "--check", patchPath], {
      cwd: root,
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024
    });
    await execFileAsync("git", ["apply", patchPath], {
      cwd: root,
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024
    });
    return { ok: true };
  } catch (error) {
    const err = error as Error & { stderr?: string };
    return {
      ok: false,
      error: `${err.message}${err.stderr ? ` | ${String(err.stderr)}` : ""}`.trim()
    };
  }
}
