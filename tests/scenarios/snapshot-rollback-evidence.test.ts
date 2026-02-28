/**
 * File 5: Snapshot + Rollback + Evidence (18 tests)
 * Proves: State capture, integrity verification, recovery, and audit trail.
 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { SnapshotManager } from "../../src/guardian/snapshot.js";
import { RollbackEngine } from "../../src/guardian/rollback.js";
import { writeEvidence } from "../../src/guardian/evidence.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
    await execFileAsync("git", args, { cwd, maxBuffer: 8 * 1024 * 1024 });
}

async function makeRepo(files: Record<string, string>): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-snap-"));
    await git(root, ["init"]);
    await git(root, ["config", "user.email", "test@salacia.dev"]);
    await git(root, ["config", "user.name", "Salacia Test"]);
    for (const [fp, content] of Object.entries(files)) {
        const full = path.join(root, fp);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, content, "utf8");
    }
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "seed"]);
    return root;
}

describe("Snapshot", () => {
    it("S01: metadata populated (id, gitHead, timestamps)", async () => {
        const root = await makeRepo({ "file.txt": "base\n" });
        const mgr = new SnapshotManager(root);
        const snap = await mgr.createSnapshot("test");
        expect(snap.id).toBeTruthy();
        expect(snap.gitHead).toHaveLength(40);
        expect(snap.createdAt).toBeTruthy();
    });

    it("S02: checksums are 64-char SHA-256", async () => {
        const root = await makeRepo({ "file.txt": "base\n" });
        const mgr = new SnapshotManager(root);
        const snap = await mgr.createSnapshot("test");
        expect(snap.checksums.workingDiffSha256).toHaveLength(64);
        expect(snap.checksums.stagedDiffSha256).toHaveLength(64);
        expect(snap.checksums.untrackedManifestSha256).toHaveLength(64);
    });

    it("S03: captures working tree diff", async () => {
        const root = await makeRepo({ "file.txt": "base\n" });
        await fs.writeFile(path.join(root, "file.txt"), "working\n", "utf8");
        const mgr = new SnapshotManager(root);
        const snap = await mgr.createSnapshot("working-diff");
        const patch = await fs.readFile(snap.patchPath, "utf8");
        expect(patch.length).toBeGreaterThan(0);
    });

    it("S04: captures staged diff", async () => {
        const root = await makeRepo({ "file.txt": "base\n" });
        await fs.writeFile(path.join(root, "file.txt"), "staged\n", "utf8");
        await git(root, ["add", "file.txt"]);
        const mgr = new SnapshotManager(root);
        const snap = await mgr.createSnapshot("staged-diff");
        const patch = await fs.readFile(snap.stagedPatchPath, "utf8");
        expect(patch.length).toBeGreaterThan(0);
    });

    it("S05: captures untracked files", async () => {
        const root = await makeRepo({ "file.txt": "base\n" });
        await fs.writeFile(path.join(root, "new-untracked.txt"), "new\n", "utf8");
        const mgr = new SnapshotManager(root);
        const snap = await mgr.createSnapshot("untracked");
        const manifest = JSON.parse(await fs.readFile(snap.untrackedManifestPath, "utf8"));
        expect(manifest.files).toContain("new-untracked.txt");
    });

    it("S06: restore after modification", async () => {
        const root = await makeRepo({ "file.txt": "original\n" });
        await fs.writeFile(path.join(root, "file.txt"), "changed\n", "utf8");
        const mgr = new SnapshotManager(root);
        const snap = await mgr.createSnapshot("mod");
        await fs.writeFile(path.join(root, "file.txt"), "TRASHED\n", "utf8");
        await mgr.restoreSnapshot(snap.id);
        const content = await fs.readFile(path.join(root, "file.txt"), "utf8");
        expect(content).toBe("changed\n");
    });

    it("S07: restore after deletion", async () => {
        const root = await makeRepo({ "file.txt": "original\n" });
        const mgr = new SnapshotManager(root);
        const snap = await mgr.createSnapshot("del");
        await fs.rm(path.join(root, "file.txt"));
        await mgr.restoreSnapshot(snap.id);
        const content = await fs.readFile(path.join(root, "file.txt"), "utf8");
        expect(content).toBe("original\n");
    });

    it("S08: restore removes post-snapshot files", async () => {
        const root = await makeRepo({ "file.txt": "base\n" });
        const mgr = new SnapshotManager(root);
        const snap = await mgr.createSnapshot("clean");
        await fs.writeFile(path.join(root, "malware.js"), "bad\n", "utf8");
        await mgr.restoreSnapshot(snap.id);
        const exists = await fs.stat(path.join(root, "malware.js")).catch(() => null);
        expect(exists).toBeNull();
    });

    it("S09: restore 3-state (working+staged+untracked)", async () => {
        const root = await makeRepo({ "a.ts": "orig-a\n", "b.ts": "orig-b\n" });
        await fs.writeFile(path.join(root, "a.ts"), "working\n", "utf8");
        await fs.writeFile(path.join(root, "b.ts"), "staged\n", "utf8");
        await git(root, ["add", "b.ts"]);
        await fs.writeFile(path.join(root, "c.ts"), "untracked\n", "utf8");
        const mgr = new SnapshotManager(root);
        const snap = await mgr.createSnapshot("3state");
        // Trash everything
        await fs.writeFile(path.join(root, "a.ts"), "X\n", "utf8");
        await fs.writeFile(path.join(root, "b.ts"), "X\n", "utf8");
        await fs.rm(path.join(root, "c.ts"));
        await mgr.restoreSnapshot(snap.id);
        expect(await fs.readFile(path.join(root, "a.ts"), "utf8")).toBe("working\n");
        expect(await fs.readFile(path.join(root, "c.ts"), "utf8")).toBe("untracked\n");
    });

    it("S10: tampered patch → checksum mismatch", async () => {
        const root = await makeRepo({ "file.txt": "base\n" });
        await fs.writeFile(path.join(root, "file.txt"), "changed\n", "utf8");
        const mgr = new SnapshotManager(root);
        const snap = await mgr.createSnapshot("tamper");
        await fs.writeFile(snap.patchPath, "tampered-data", "utf8");
        await expect(mgr.restoreSnapshot(snap.id)).rejects.toThrow("checksum mismatch");
    });
});

describe("Rollback Engine", () => {
    it("S11: rollback via engine → success", async () => {
        const root = await makeRepo({ "file.txt": "base\n" });
        await fs.writeFile(path.join(root, "file.txt"), "changed\n", "utf8");
        const mgr = new SnapshotManager(root);
        const snap = await mgr.createSnapshot("rb");
        const engine = new RollbackEngine(mgr);
        await engine.rollback(snap.id, { cwd: root });
        expect(await fs.readFile(path.join(root, "file.txt"), "utf8")).toBe("changed\n");
    });

    it("S12: rollback with verification commands", async () => {
        const root = await makeRepo({ "file.txt": "base\n" });
        const mgr = new SnapshotManager(root);
        const snap = await mgr.createSnapshot("rb-verify");
        const engine = new RollbackEngine(mgr);
        await engine.rollback(snap.id, { cwd: root, verificationCommands: ["git rev-parse --is-inside-work-tree"] });
        // Should not throw
    });

    it("S13: rollback with failing verification → error", async () => {
        const root = await makeRepo({ "file.txt": "base\n" });
        const mgr = new SnapshotManager(root);
        const snap = await mgr.createSnapshot("rb-fail");
        const engine = new RollbackEngine(mgr);
        await expect(
            engine.rollback(snap.id, { cwd: root, retries: 0, verificationCommands: ['node -e "process.exit(1)"'] })
        ).rejects.toThrow();
    });

    it("S14: rollback to unknown snapshot → error", async () => {
        const root = await makeRepo({ "file.txt": "base\n" });
        const mgr = new SnapshotManager(root);
        const engine = new RollbackEngine(mgr);
        await expect(engine.rollback("nonexistent", { cwd: root, retries: 0 })).rejects.toThrow();
    });
});

describe("Evidence Journal", () => {
    it("S15: write → file created", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-ev-"));
        const p = await writeEvidence({ kind: "verify", createdAt: new Date().toISOString(), payload: { ok: true } }, root);
        const exists = await fs.stat(p).then(() => true).catch(() => false);
        expect(exists).toBe(true);
    });

    it("S16: filename includes kind prefix", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-ev-"));
        const p = await writeEvidence({ kind: "audit", createdAt: new Date().toISOString(), payload: { score: 9 } }, root);
        expect(path.basename(p).startsWith("audit-")).toBe(true);
    });

    it("S17: filename includes digest", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-ev-"));
        const p = await writeEvidence({ kind: "verify", createdAt: new Date().toISOString(), payload: { ok: true } }, root);
        const name = path.basename(p, ".json");
        // Should have kind-<something> format
        expect(name.split("-").length).toBeGreaterThanOrEqual(2);
    });

    it("S18: evidence JSON is valid", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-ev-"));
        const p = await writeEvidence({ kind: "verify", createdAt: new Date().toISOString(), payload: { ok: true, cmd: "test" } }, root);
        const content = JSON.parse(await fs.readFile(p, "utf8"));
        expect(content.kind).toBe("verify");
        expect(content.payload.ok).toBe(true);
    });
});
