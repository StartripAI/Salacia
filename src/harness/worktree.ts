import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function sanitizePart(input: string): string {
  return String(input)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "x";
}

async function runGit(
  cwd: string,
  args: string[],
  timeout = 120_000
): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      timeout,
      maxBuffer: 10 * 1024 * 1024
    });
    return {
      ok: true,
      stdout: String(stdout || ""),
      stderr: String(stderr || ""),
      code: 0
    };
  } catch (error) {
    const err = error as Error & { stdout?: string; stderr?: string; code?: number };
    return {
      ok: false,
      stdout: String(err.stdout || ""),
      stderr: `${String(err.stderr || "")}\n${err.message}`.trim(),
      code: typeof err.code === "number" ? err.code : 1
    };
  }
}

export interface WorktreeSession {
  role: string;
  path: string;
  created: boolean;
  fallback: boolean;
  reason: string | null;
}

export function createWorktreeRunId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function createRoleWorktree(
  root: string,
  role: string,
  runId: string,
  stepId: string
): Promise<WorktreeSession> {
  const repoCheck = await runGit(root, ["rev-parse", "--is-inside-work-tree"], 30_000);
  if (!repoCheck.ok || !repoCheck.stdout.toLowerCase().includes("true")) {
    return {
      role,
      path: root,
      created: false,
      fallback: true,
      reason: "worktree disabled: not inside git repository"
    };
  }

  const head = await runGit(root, ["rev-parse", "--verify", "HEAD"], 30_000);
  if (!head.ok || !head.stdout.trim()) {
    return {
      role,
      path: root,
      created: false,
      fallback: true,
      reason: "worktree disabled: unable to resolve HEAD"
    };
  }

  const baseDir = path.join(root, ".salacia", "journal", "worktrees", sanitizePart(runId));
  await fs.mkdir(baseDir, { recursive: true });
  const targetPath = path.join(
    baseDir,
    `${sanitizePart(stepId)}-${sanitizePart(role)}-${Date.now().toString(36)}`
  );
  await fs.rm(targetPath, { recursive: true, force: true });

  const add = await runGit(root, ["worktree", "add", "--detach", targetPath, head.stdout.trim()], 300_000);
  if (!add.ok) {
    return {
      role,
      path: root,
      created: false,
      fallback: true,
      reason: `worktree add failed: ${add.stderr.slice(0, 300)}`
    };
  }

  return {
    role,
    path: targetPath,
    created: true,
    fallback: false,
    reason: null
  };
}

export async function removeRoleWorktree(root: string, session: WorktreeSession): Promise<{ ok: boolean; error?: string }> {
  if (!session.created) {
    return { ok: true };
  }

  const remove = await runGit(root, ["worktree", "remove", "--force", session.path], 120_000);
  await fs.rm(session.path, { recursive: true, force: true }).catch(() => undefined);
  if (!remove.ok) {
    return {
      ok: false,
      error: `worktree remove failed: ${remove.stderr.slice(0, 300)}`
    };
  }

  return { ok: true };
}
