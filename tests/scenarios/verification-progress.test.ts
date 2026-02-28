/**
 * File 6: Verification System + Progress Tracking (16 tests)
 * Proves: Multi-command verification, evidence persistence, progress state machine.
 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { runVerificationCommands, runVerification } from "../../src/guardian/verify.js";
import { ProgressTracker } from "../../src/guardian/progress.js";
import { createContractFromVibe } from "../../src/core/contract.js";
import { ensureSalaciaDirs } from "../../src/core/paths.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
    await execFileAsync("git", args, { cwd, maxBuffer: 8 * 1024 * 1024 });
}

async function tmpDir(): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-verify-"));
    await git(root, ["init"]);
    await git(root, ["config", "user.email", "test@salacia.dev"]);
    await git(root, ["config", "user.name", "Salacia Test"]);
    await fs.writeFile(path.join(root, "dummy"), "x\n", "utf8");
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "init"]);
    await ensureSalaciaDirs(root);
    return root;
}

describe("Verification System", () => {
    it("P01: single passing command → success", async () => {
        const cwd = await tmpDir();
        const r = await runVerificationCommands("c1", ['node -e "process.exit(0)"'], cwd);
        expect(r.success).toBe(true);
        expect(r.results.length).toBe(1);
        expect(r.results[0].success).toBe(true);
    });

    it("P02: single failing command → failure", async () => {
        const cwd = await tmpDir();
        const r = await runVerificationCommands("c1", ['node -e "process.exit(1)"'], cwd);
        expect(r.success).toBe(false);
        expect(r.results[0].success).toBe(false);
    });

    it("P03: multiple all pass → success", async () => {
        const cwd = await tmpDir();
        const r = await runVerificationCommands("c1", ['node -e "process.exit(0)"', 'node -e "process.exit(0)"'], cwd);
        expect(r.success).toBe(true);
        expect(r.results.every((x) => x.success)).toBe(true);
    });

    it("P04: multiple, one fails → failure", async () => {
        const cwd = await tmpDir();
        const r = await runVerificationCommands("c1", ['node -e "process.exit(0)"', 'node -e "process.exit(1)"'], cwd);
        expect(r.success).toBe(false);
    });

    it("P05: command output captured", async () => {
        const cwd = await tmpDir();
        const r = await runVerificationCommands("c1", ['node -e "console.log(42)"'], cwd);
        expect(r.results[0].output).toContain("42");
    });

    it("P06: exit code recorded", async () => {
        const cwd = await tmpDir();
        const r = await runVerificationCommands("c1", ['node -e "process.exit(0)"', 'node -e "process.exit(1)"'], cwd);
        expect(r.results[0].exitCode).toBe(0);
        expect(r.results[1].exitCode).not.toBe(0);
    });

    it("P07: evidence path created", async () => {
        const cwd = await tmpDir();
        const r = await runVerificationCommands("c1", ['node -e "process.exit(0)"'], cwd, { persistEvidence: true });
        expect(r.evidencePath).toBeDefined();
        const exists = await fs.stat(r.evidencePath!).then(() => true).catch(() => false);
        expect(exists).toBe(true);
    });

    it("P08: evidence not created when opt-out", async () => {
        const cwd = await tmpDir();
        const r = await runVerificationCommands("c1", ['node -e "process.exit(0)"'], cwd, { persistEvidence: false });
        expect(r.evidencePath).toBeUndefined();
    });

    it("P09: runVerification uses contract commands", async () => {
        const cwd = await tmpDir();
        const c = createContractFromVibe("test", "repo");
        c.verification.commands = ['node -e "console.log(99)"'];
        const r = await runVerification(c, cwd);
        expect(r.success).toBe(true);
        expect(r.results[0].output).toContain("99");
    });

    it("P10: empty commands → success", async () => {
        const cwd = await tmpDir();
        const r = await runVerificationCommands("c1", [], cwd);
        expect(r.success).toBe(true);
        expect(r.results.length).toBe(0);
    });
});

describe("Progress Tracking", () => {
    it("P11: init from plan → all todo", async () => {
        const cwd = await tmpDir();
        const tracker = new ProgressTracker(cwd);
        await tracker.initializeFromPlan({
            contractId: "c-1", generatedAt: new Date().toISOString(), summary: "test",
            steps: [
                { id: "s1", riskLevel: "low", expectedArtifacts: [], verification: [] },
                { id: "s2", riskLevel: "low", expectedArtifacts: [], verification: [] },
            ],
        });
        const p = await tracker.read();
        expect(p).not.toBeNull();
        expect(p!.items.every((i) => i.status === "todo")).toBe(true);
    });

    it("P12: updateStep doing", async () => {
        const cwd = await tmpDir();
        const tracker = new ProgressTracker(cwd);
        await tracker.initializeFromPlan({
            contractId: "c-1", generatedAt: new Date().toISOString(), summary: "test",
            steps: [{ id: "s1", riskLevel: "low", expectedArtifacts: [], verification: [] }],
        });
        await tracker.updateStep("s1", "doing", false);
        const p = await tracker.read();
        expect(p!.items[0].status).toBe("doing");
    });

    it("P13: updateStep done with passes=true", async () => {
        const cwd = await tmpDir();
        const tracker = new ProgressTracker(cwd);
        await tracker.initializeFromPlan({
            contractId: "c-1", generatedAt: new Date().toISOString(), summary: "test",
            steps: [{ id: "s1", riskLevel: "low", expectedArtifacts: [], verification: [] }],
        });
        await tracker.updateStep("s1", "done", true);
        const p = await tracker.read();
        expect(p!.items[0].status).toBe("done");
        expect(p!.items[0].passes).toBe(true);
    });

    it("P14: updateStep failed", async () => {
        const cwd = await tmpDir();
        const tracker = new ProgressTracker(cwd);
        await tracker.initializeFromPlan({
            contractId: "c-1", generatedAt: new Date().toISOString(), summary: "test",
            steps: [{ id: "s1", riskLevel: "low", expectedArtifacts: [], verification: [] }],
        });
        await tracker.updateStep("s1", "failed", false);
        const p = await tracker.read();
        expect(p!.items[0].status).toBe("failed");
        expect(p!.items[0].passes).toBe(false);
    });

    it("P15: read after write → consistent", async () => {
        const cwd = await tmpDir();
        const tracker = new ProgressTracker(cwd);
        await tracker.initializeFromPlan({
            contractId: "c-1", generatedAt: new Date().toISOString(), summary: "test",
            steps: [{ id: "s1", riskLevel: "low", expectedArtifacts: [], verification: [] }],
        });
        await tracker.updateStep("s1", "done", true);
        // Read twice — should be same
        const p1 = await tracker.read();
        const p2 = await tracker.read();
        expect(p1!.items[0].status).toBe(p2!.items[0].status);
    });

    it("P16: multiple steps independent", async () => {
        const cwd = await tmpDir();
        const tracker = new ProgressTracker(cwd);
        await tracker.initializeFromPlan({
            contractId: "c-1", generatedAt: new Date().toISOString(), summary: "test",
            steps: [
                { id: "s1", riskLevel: "low", expectedArtifacts: [], verification: [] },
                { id: "s2", riskLevel: "low", expectedArtifacts: [], verification: [] },
                { id: "s3", riskLevel: "low", expectedArtifacts: [], verification: [] },
            ],
        });
        await tracker.updateStep("s1", "done", true);
        await tracker.updateStep("s2", "failed", false);
        const p = await tracker.read();
        expect(p!.items.find((i) => i.id === "s1")?.status).toBe("done");
        expect(p!.items.find((i) => i.id === "s2")?.status).toBe("failed");
        expect(p!.items.find((i) => i.id === "s3")?.status).toBe("todo");
    });
});
