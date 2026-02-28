import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getSalaciaPaths } from "../core/paths.js";

const execFileAsync = promisify(execFile);

export interface SnapshotRecord {
  id: string;
  createdAt: string;
  label: string;
  gitHead: string;
  patchPath: string;
  stagedPatchPath: string;
  untrackedManifestPath: string;
  checksums: {
    workingDiffSha256: string;
    stagedDiffSha256: string;
    untrackedManifestSha256: string;
  };
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 5 * 1024 * 1024 });
  return stdout;
}

function sha(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export class SnapshotManager {
  constructor(private readonly root = process.cwd()) {}

  async createSnapshot(label = "manual"): Promise<SnapshotRecord> {
    const paths = getSalaciaPaths(this.root);
    await fs.mkdir(paths.snapshots, { recursive: true });

    const id = new Date().toISOString().replace(/[:.]/g, "-");
    const dir = path.join(paths.snapshots, id);
    await fs.mkdir(dir, { recursive: true });

    const patchPath = path.join(dir, "working.diff");
    const stagedPatchPath = path.join(dir, "staged.diff");
    const untrackedManifestPath = path.join(dir, "untracked.json");

    const [workingDiff, stagedDiff, untrackedRaw, gitHead] = await Promise.all([
      runGit(["diff", "--binary"], this.root).catch(() => ""),
      runGit(["diff", "--cached", "--binary"], this.root).catch(() => ""),
      runGit(["ls-files", "--others", "--exclude-standard"], this.root).catch(() => ""),
      runGit(["rev-parse", "HEAD"], this.root).catch(() => "unknown")
    ]);

    await fs.writeFile(patchPath, workingDiff, "utf8");
    await fs.writeFile(stagedPatchPath, stagedDiff, "utf8");

    const untracked = untrackedRaw
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .sort();

    const backups: string[] = [];
    for (const rel of untracked) {
      const from = path.join(this.root, rel);
      const to = path.join(dir, "untracked", rel);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.copyFile(from, to).catch(() => undefined);
      backups.push(rel);
    }

    const manifestRaw = JSON.stringify({ files: backups }, null, 2);
    await fs.writeFile(untrackedManifestPath, manifestRaw, "utf8");

    const record: SnapshotRecord = {
      id,
      createdAt: new Date().toISOString(),
      label,
      gitHead: gitHead.trim(),
      patchPath,
      stagedPatchPath,
      untrackedManifestPath,
      checksums: {
        workingDiffSha256: sha(workingDiff),
        stagedDiffSha256: sha(stagedDiff),
        untrackedManifestSha256: sha(manifestRaw)
      }
    };

    await fs.writeFile(path.join(dir, "metadata.json"), JSON.stringify(record, null, 2), "utf8");
    return record;
  }

  async listSnapshots(): Promise<SnapshotRecord[]> {
    const paths = getSalaciaPaths(this.root);
    const dirs = await fs.readdir(paths.snapshots).catch(() => []);
    const records: SnapshotRecord[] = [];
    for (const id of dirs) {
      const metadataPath = path.join(paths.snapshots, id, "metadata.json");
      const raw = await fs.readFile(metadataPath, "utf8").catch(() => "");
      if (!raw) continue;
      records.push(JSON.parse(raw) as SnapshotRecord);
    }
    records.sort((a, b) => (a.id > b.id ? -1 : 1));
    return records;
  }

  async restoreSnapshot(snapshotId: string): Promise<void> {
    const dir = path.join(getSalaciaPaths(this.root).snapshots, snapshotId);
    const metadata = JSON.parse(await fs.readFile(path.join(dir, "metadata.json"), "utf8")) as SnapshotRecord;

    const patch = await fs.readFile(metadata.patchPath, "utf8").catch(() => "");
    if (sha(patch) !== metadata.checksums.workingDiffSha256) {
      throw new Error("Snapshot checksum mismatch: working diff");
    }

    const stagedPatch = await fs.readFile(metadata.stagedPatchPath, "utf8").catch(() => "");
    if (sha(stagedPatch) !== metadata.checksums.stagedDiffSha256) {
      throw new Error("Snapshot checksum mismatch: staged diff");
    }

    const manifestRaw = await fs.readFile(metadata.untrackedManifestPath, "utf8");
    if (sha(manifestRaw) !== metadata.checksums.untrackedManifestSha256) {
      throw new Error("Snapshot checksum mismatch: untracked manifest");
    }

    // Step 1: Reset tracked files to the snapshot's git HEAD
    // This handles files that were deleted or modified after the snapshot
    await execFileAsync("git", ["checkout", metadata.gitHead, "--", "."], { cwd: this.root });
    // Remove untracked files/dirs that appeared after the snapshot
    // Exclude .salacia/ to preserve snapshot data needed for the remaining restore steps
    await execFileAsync("git", ["clean", "-fd", "-e", ".salacia"], { cwd: this.root });

    // Step 2: Re-apply the working tree diff that existed at snapshot time
    if (patch.trim()) {
      const temp = path.join(dir, "apply.patch");
      await fs.writeFile(temp, patch, "utf8");
      await execFileAsync("git", ["apply", temp], { cwd: this.root });
    }

    // Step 3: Re-apply the staged diff that existed at snapshot time
    if (stagedPatch.trim()) {
      const temp = path.join(dir, "apply-staged.patch");
      await fs.writeFile(temp, stagedPatch, "utf8");
      await execFileAsync("git", ["apply", "--cached", temp], { cwd: this.root });
    }

    // Step 4: Restore untracked files that existed at snapshot time
    const manifest = JSON.parse(manifestRaw) as { files: string[] };
    for (const rel of manifest.files) {
      const backup = path.join(dir, "untracked", rel);
      const target = path.join(this.root, rel);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(backup, target).catch(() => undefined);
    }
  }
}
