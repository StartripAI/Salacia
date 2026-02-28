#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizePath(value) {
  return String(value || "").replaceAll("\\", "/");
}

async function runGit(repoPath, args, timeout = 60_000) {
  const joinOutput = (stdout, stderr) => {
    const out = String(stdout || "");
    const err = String(stderr || "");
    if (!out) return err;
    if (!err) return out;
    return out.endsWith("\n") ? `${out}${err}` : `${out}\n${err}`;
  };

  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd: repoPath,
      timeout,
      maxBuffer: 64 * 1024 * 1024
    });
    return {
      ok: true,
      code: 0,
      output: joinOutput(stdout, stderr)
    };
  } catch (error) {
    return {
      ok: false,
      code: typeof error?.code === "number" ? error.code : 1,
      output: joinOutput(
        joinOutput(error?.stdout ?? "", error?.stderr ?? ""),
        error?.message ?? ""
      )
    };
  }
}

function parseStatus(raw) {
  return String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length >= 3)
    .map((line) => {
      const match = line.match(/^(.{2})\s+(.*)$/);
      if (!match) return null;
      const code = match[1];
      const relPath = normalizePath(
        match[2].includes(" -> ")
          ? match[2].split(" -> ").pop()
          : match[2]
      ).trim();
      return {
        code,
        path: relPath
      };
    })
    .filter(Boolean);
}

async function collectUntracked(repoPath, statusRows) {
  const out = [];
  for (const row of statusRows) {
    if (!row.code.includes("?")) continue;
    const relPath = row.path;
    const absolutePath = path.join(repoPath, relPath);
    let content;
    try {
      content = await fs.readFile(absolutePath);
    } catch {
      continue;
    }
    const stat = await fs.stat(absolutePath).catch(() => null);
    out.push({
      path: relPath,
      size: stat?.size ?? content.length,
      mode: stat?.mode ?? null,
      sha256: sha256(content),
      encoding: "base64",
      content: content.toString("base64")
    });
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

function buildStateChecksumPayload(snapshot) {
  return {
    version: snapshot.version,
    head: snapshot.head,
    status: snapshot.status,
    workingPatchHash: sha256(snapshot.workingPatch || ""),
    stagedPatchHash: sha256(snapshot.stagedPatch || ""),
    untracked: (snapshot.untrackedFiles || []).map((item) => ({
      path: item.path,
      size: item.size,
      mode: item.mode,
      sha256: item.sha256
    }))
  };
}

function toCanonicalSnapshot(snapshot) {
  return {
    version: snapshot.version,
    id: snapshot.id,
    label: snapshot.label,
    createdAt: snapshot.createdAt,
    repoPath: snapshot.repoPath,
    head: snapshot.head,
    status: snapshot.status,
    workingPatch: snapshot.workingPatch,
    stagedPatch: snapshot.stagedPatch,
    untrackedFiles: snapshot.untrackedFiles,
    stateChecksum: snapshot.stateChecksum
  };
}

async function captureWorkspace(repoPath, label, id) {
  const [head, status, workingPatch, stagedPatch] = await Promise.all([
    runGit(repoPath, ["rev-parse", "HEAD"], 30_000),
    runGit(repoPath, ["status", "--porcelain=v1", "--untracked-files=all"], 30_000),
    runGit(repoPath, ["diff", "--binary"], 30_000),
    runGit(repoPath, ["diff", "--cached", "--binary"], 30_000)
  ]);

  if (!head.ok || !status.ok || !workingPatch.ok || !stagedPatch.ok) {
    return {
      ok: false,
      reason: "failed to capture git workspace state",
      errors: {
        head,
        status,
        workingPatch,
        stagedPatch
      }
    };
  }

  const statusRows = parseStatus(status.output);
  const untrackedFiles = await collectUntracked(repoPath, statusRows);

  const snapshot = {
    version: "v1",
    id: id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: label || "snapshot",
    createdAt: new Date().toISOString(),
    repoPath,
    head: String(head.output).trim(),
    status: String(status.output || ""),
    workingPatch: String(workingPatch.output || ""),
    stagedPatch: String(stagedPatch.output || ""),
    untrackedFiles
  };

  snapshot.stateChecksum = sha256(JSON.stringify(buildStateChecksumPayload(snapshot)));
  const canonical = toCanonicalSnapshot(snapshot);
  snapshot.snapshotChecksum = sha256(JSON.stringify(canonical));

  return {
    ok: true,
    snapshot
  };
}

export function verifySnapshotChecksum(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return { ok: false, reason: "snapshot payload missing" };
  }
  const canonical = toCanonicalSnapshot(snapshot);
  const expected = sha256(JSON.stringify(canonical));
  if (expected !== snapshot.snapshotChecksum) {
    return {
      ok: false,
      reason: "snapshot checksum mismatch",
      expected,
      actual: snapshot.snapshotChecksum || null
    };
  }
  return { ok: true, expected };
}

export async function createBenchmarkSnapshot(repoPath, snapshotPath, options = {}) {
  const captured = await captureWorkspace(repoPath, options.label, options.id);
  if (!captured.ok) {
    return captured;
  }

  const snapshot = captured.snapshot;
  await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
  await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), "utf8");

  return {
    ok: true,
    snapshotPath,
    snapshot
  };
}

export async function readBenchmarkSnapshot(snapshotPath) {
  const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
  const integrity = verifySnapshotChecksum(snapshot);
  return {
    ok: integrity.ok,
    integrity,
    snapshot
  };
}

async function applyPatchFile(repoPath, patchText, staged) {
  if (!String(patchText || "").trim()) {
    return {
      ok: true,
      applied: false,
      reason: "empty patch"
    };
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-bench-patch-"));
  const patchPath = path.join(tempDir, staged ? "staged.patch" : "working.patch");
  await fs.writeFile(patchPath, patchText, "utf8");

  const args = staged
    ? ["apply", "--cached", "--binary", "--whitespace=nowarn", patchPath]
    : ["apply", "--binary", "--whitespace=nowarn", patchPath];

  const applied = await runGit(repoPath, args, 60_000);
  await fs.rm(tempDir, { recursive: true, force: true });
  return {
    ok: applied.ok,
    applied: true,
    command: `git ${args.join(" ")}`,
    output: applied.output
  };
}

async function restoreUntrackedFiles(repoPath, untrackedFiles) {
  const restored = [];
  for (const file of untrackedFiles || []) {
    if (!file?.path || !file?.content) continue;
    const absolutePath = path.join(repoPath, file.path);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    const content = Buffer.from(String(file.content), "base64");
    await fs.writeFile(absolutePath, content);
    if (typeof file.mode === "number") {
      await fs.chmod(absolutePath, file.mode).catch(() => undefined);
    }
    restored.push(file.path);
  }
  return restored;
}

export async function restoreBenchmarkSnapshot(repoPath, snapshotPath) {
  const loaded = await readBenchmarkSnapshot(snapshotPath).catch((error) => ({
    ok: false,
    integrity: { ok: false, reason: error.message },
    snapshot: null
  }));

  if (!loaded.ok) {
    return {
      ok: false,
      snapshotPath,
      reason: loaded.integrity?.reason || "snapshot integrity verification failed",
      integrity: loaded.integrity
    };
  }

  const snapshot = loaded.snapshot;
  const steps = [];

  const reset = await runGit(repoPath, ["reset", "--hard", "HEAD"], 30_000);
  steps.push({ step: "git-reset", ok: reset.ok, output: reset.output });
  if (!reset.ok) {
    return {
      ok: false,
      snapshotPath,
      reason: "failed to reset workspace",
      steps,
      integrity: loaded.integrity
    };
  }

  const clean = await runGit(repoPath, ["clean", "-fd"], 30_000);
  steps.push({ step: "git-clean", ok: clean.ok, output: clean.output });
  if (!clean.ok) {
    return {
      ok: false,
      snapshotPath,
      reason: "failed to clean workspace",
      steps,
      integrity: loaded.integrity
    };
  }

  const stagedApply = await applyPatchFile(repoPath, snapshot.stagedPatch, true);
  steps.push({ step: "apply-staged", ...stagedApply });
  if (!stagedApply.ok) {
    return {
      ok: false,
      snapshotPath,
      reason: "failed to restore staged patch",
      steps,
      integrity: loaded.integrity
    };
  }

  const workingApply = await applyPatchFile(repoPath, snapshot.workingPatch, false);
  steps.push({ step: "apply-working", ...workingApply });
  if (!workingApply.ok) {
    return {
      ok: false,
      snapshotPath,
      reason: "failed to restore working patch",
      steps,
      integrity: loaded.integrity
    };
  }

  const restoredUntracked = await restoreUntrackedFiles(repoPath, snapshot.untrackedFiles);
  steps.push({ step: "restore-untracked", ok: true, restored: restoredUntracked.length });

  const captured = await captureWorkspace(repoPath, snapshot.label, snapshot.id);
  if (!captured.ok) {
    return {
      ok: false,
      snapshotPath,
      reason: "failed to validate restored workspace",
      steps,
      integrity: loaded.integrity,
      validation: captured
    };
  }

  const restoredStateChecksum = captured.snapshot.stateChecksum;
  const matches = restoredStateChecksum === snapshot.stateChecksum;

  return {
    ok: matches,
    snapshotPath,
    reason: matches ? "snapshot restored and verified" : "restored workspace checksum mismatch",
    integrity: loaded.integrity,
    steps,
    restoredStateChecksum,
    expectedStateChecksum: snapshot.stateChecksum,
    snapshotId: snapshot.id,
    label: snapshot.label
  };
}

export async function runSnapshotStatusCheck(repoPath) {
  const result = await runGit(repoPath, ["status", "--porcelain=v1", "--untracked-files=all"], 30_000);
  if (!result.ok) {
    return {
      ok: false,
      command: "git status --porcelain=v1 --untracked-files=all",
      reason: "status command failed",
      output: result.output
    };
  }

  const conflicts = parseStatus(result.output).filter((row) => /^[ADU]{2}$/.test(row.code.replace(/\s/g, "")) || row.code.includes("U"));
  return {
    ok: conflicts.length === 0,
    command: "git status --porcelain=v1 --untracked-files=all",
    reason: conflicts.length === 0 ? "workspace status check passed" : "workspace has unresolved conflicts",
    output: result.output,
    conflicts
  };
}
