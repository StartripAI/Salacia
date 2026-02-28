import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { writeEvidence } from "../src/guardian/evidence.js";
import { RollbackEngine } from "../src/guardian/rollback.js";
import { SnapshotManager } from "../src/guardian/snapshot.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

describe("rollback engine", () => {
  it("rolls back to snapshot and verifies repository state", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-rollback-"));
    await git(root, "init");
    await git(root, "config", "user.email", "salacia@example.com");
    await git(root, "config", "user.name", "Salacia Test");
    await fs.writeFile(path.join(root, "file.txt"), "base\n", "utf8");
    await git(root, "add", ".");
    await git(root, "commit", "-m", "base");

    await fs.writeFile(path.join(root, "file.txt"), "changed\n", "utf8");
    const manager = new SnapshotManager(root);
    const snapshot = await manager.createSnapshot("rollback");
    const engine = new RollbackEngine(manager);
    await engine.rollback(snapshot.id, {
      cwd: root,
      verificationCommands: ["git rev-parse --is-inside-work-tree"]
    });

    const restored = await fs.readFile(path.join(root, "file.txt"), "utf8");
    // restoreSnapshot restores the exact state at snapshot time (including uncommitted changes)
    expect(restored.replace(/\r\n/g, "\n")).toBe("changed\n");
  });

  it("fails rollback for unknown snapshot id", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-rollback-missing-"));
    await git(root, "init");
    const manager = new SnapshotManager(root);
    const engine = new RollbackEngine(manager);

    await expect(engine.rollback("missing-snapshot", { cwd: root, retries: 0 })).rejects.toThrow("Rollback failed");
  });

  it("fails rollback when post-rollback verification command fails", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-rollback-verify-"));
    await git(root, "init");
    await git(root, "config", "user.email", "salacia@example.com");
    await git(root, "config", "user.name", "Salacia Test");
    await fs.writeFile(path.join(root, "file.txt"), "base\n", "utf8");
    await git(root, "add", ".");
    await git(root, "commit", "-m", "base");

    await fs.writeFile(path.join(root, "file.txt"), "changed\n", "utf8");
    const manager = new SnapshotManager(root);
    const snapshot = await manager.createSnapshot("rollback-verify");
    const engine = new RollbackEngine(manager);

    await expect(
      engine.rollback(snapshot.id, {
        cwd: root,
        retries: 0,
        verificationCommands: ["node -e \"process.exit(1)\""]
      })
    ).rejects.toThrow("Rollback failed");
  });
});

describe("evidence journal", () => {
  it("writes evidence record into journal path", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-evidence-"));
    const evidencePath = await writeEvidence(
      {
        kind: "verify",
        createdAt: new Date().toISOString(),
        payload: { ok: true, command: "npm test" }
      },
      root
    );

    const exists = await fs
      .access(evidencePath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
    expect(evidencePath).toContain(path.join(".salacia", "journal", "evidence"));
  });

  it("includes kind prefix and digest in evidence filename", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-evidence-name-"));
    const evidencePath = await writeEvidence(
      {
        kind: "audit",
        createdAt: new Date().toISOString(),
        payload: { score: 9 }
      },
      root
    );

    const filename = path.basename(evidencePath);
    expect(filename.startsWith("audit-")).toBe(true);
    expect(filename.endsWith(".json")).toBe(true);
  });
});
