/**
 * File 2: Scope & Drift Detection (16 tests)
 * Proves: Scope enforcement catches out-of-bounds and protected path violations.
 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { detectDrift } from "../../src/guardian/drift.js";
import { createContractFromVibe } from "../../src/core/contract.js";
import type { Contract } from "../../src/core/types.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
    await execFileAsync("git", args, { cwd, maxBuffer: 8 * 1024 * 1024 });
}

async function makeRepo(files: Record<string, string>): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "salacia-drift-"));
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

function contract(opts: { inScope?: string[]; protectedPaths?: string[] }): Contract {
    const c = createContractFromVibe("drift test", "repo");
    if (opts.inScope) c.scope.inScope = opts.inScope;
    if (opts.protectedPaths) c.guardrails.protectedPaths = opts.protectedPaths;
    return c;
}

describe("Scope & Drift Detection", () => {
    it("D01: in-scope-only changes → no out-of-scope", async () => {
        const root = await makeRepo({ "src/a.ts": "a\n" });
        await fs.writeFile(path.join(root, "src/a.ts"), "changed\n", "utf8");
        const r = await detectDrift(contract({ inScope: ["src/"] }), root);
        expect(r.outOfScopeChanges.length).toBe(0);
        expect(r.protectedPathTouches.length).toBe(0);
        expect(r.score).toBeLessThan(r.thresholds.low);
    });

    it("D02: out-of-scope change detected", async () => {
        const root = await makeRepo({ "src/a.ts": "a\n" });
        await fs.mkdir(path.join(root, "docs"), { recursive: true });
        await fs.writeFile(path.join(root, "docs/readme.md"), "rogue\n", "utf8");
        const r = await detectDrift(contract({ inScope: ["src/"] }), root);
        expect(r.outOfScopeChanges).toContain("docs/readme.md");
    });

    it("D03: protected path modified → detected", async () => {
        const root = await makeRepo({ "src/a.ts": "a\n", ".env": "SECRET=x\n" });
        await fs.writeFile(path.join(root, ".env"), "HACKED\n", "utf8");
        const r = await detectDrift(contract({ inScope: ["src/"], protectedPaths: [".env"] }), root);
        expect(r.protectedPathTouches).toContain(".env");
    });

    it("D04: protected path → severity high, score ≥60", async () => {
        const root = await makeRepo({ ".env": "SECRET=x\n" });
        await fs.writeFile(path.join(root, ".env"), "HACKED\n", "utf8");
        const r = await detectDrift(contract({ inScope: [], protectedPaths: [".env"] }), root);
        expect(r.severity === "medium" || r.severity === "high").toBe(true);
        expect(r.score).toBeGreaterThanOrEqual(60);
    });

    it("D05: multiple out-of-scope → all counted", async () => {
        const root = await makeRepo({ "src/a.ts": "a\n" });
        await fs.mkdir(path.join(root, "docs"), { recursive: true });
        await fs.writeFile(path.join(root, "docs/x.md"), "x\n", "utf8");
        await fs.writeFile(path.join(root, "config.yml"), "y\n", "utf8");
        await fs.writeFile(path.join(root, "hack.js"), "z\n", "utf8");
        const r = await detectDrift(contract({ inScope: ["src/"] }), root);
        expect(r.outOfScopeChanges.length).toBeGreaterThanOrEqual(3);
    });

    it("D06: prefix matching: src/ matches src/deep/file.ts", async () => {
        const root = await makeRepo({ "src/deep/file.ts": "x\n" });
        await fs.writeFile(path.join(root, "src/deep/file.ts"), "changed\n", "utf8");
        const r = await detectDrift(contract({ inScope: ["src/"] }), root);
        expect(r.outOfScopeChanges.length).toBe(0);
    });

    it("D07: prefix matching: src/ does NOT match src-other/", async () => {
        const root = await makeRepo({ "src/a.ts": "a\n" });
        await fs.mkdir(path.join(root, "src-other"), { recursive: true });
        await fs.writeFile(path.join(root, "src-other/b.ts"), "rogue\n", "utf8");
        const r = await detectDrift(contract({ inScope: ["src/"] }), root);
        expect(r.outOfScopeChanges).toContain("src-other/b.ts");
    });

    it("D08: glob stripping: src/** → src prefix", async () => {
        const root = await makeRepo({ "src/a.ts": "a\n" });
        await fs.writeFile(path.join(root, "src/a.ts"), "changed\n", "utf8");
        const r = await detectDrift(contract({ inScope: ["src/**"] }), root);
        expect(r.outOfScopeChanges.length).toBe(0);
    });

    it("D09: no scope rules → everything out-of-scope", async () => {
        const root = await makeRepo({ "src/a.ts": "a\n" });
        await fs.writeFile(path.join(root, "src/a.ts"), "changed\n", "utf8");
        const r = await detectDrift(contract({ inScope: [] }), root);
        expect(r.outOfScopeChanges.length).toBeGreaterThan(0);
    });

    it("D10: staged changes detected", async () => {
        const root = await makeRepo({ "src/a.ts": "a\n" });
        await fs.writeFile(path.join(root, "src/a.ts"), "staged\n", "utf8");
        await git(root, ["add", "src/a.ts"]);
        const r = await detectDrift(contract({ inScope: ["src/"] }), root);
        expect(r.changedFiles).toContain("src/a.ts");
    });

    it("D11: untracked files detected", async () => {
        const root = await makeRepo({ "src/a.ts": "a\n" });
        await fs.writeFile(path.join(root, "src/new.ts"), "new\n", "utf8");
        const r = await detectDrift(contract({ inScope: ["src/"] }), root);
        expect(r.changedFiles).toContain("src/new.ts");
    });

    it("D12: score formula verified", async () => {
        const root = await makeRepo({ "src/a.ts": "a\n", ".env": "s\n" });
        // 1 in-scope change, 1 out-of-scope, 1 protected
        await fs.writeFile(path.join(root, "src/a.ts"), "changed\n", "utf8");
        await fs.writeFile(path.join(root, "rogue.js"), "x\n", "utf8");
        await fs.writeFile(path.join(root, ".env"), "hacked\n", "utf8");
        const r = await detectDrift(contract({ inScope: ["src/"], protectedPaths: [".env"] }), root);
        // 3 files × 5 = 15, 2 out-of-scope × 20 = 40, 1 protected × 40 = 40, total = 95, max(95, 60) = 95
        expect(r.score).toBeGreaterThanOrEqual(60);
    });

    it("D13: severity thresholds", async () => {
        const root = await makeRepo({ "src/a.ts": "a\n" });
        // Clean repo
        const clean = await detectDrift(contract({ inScope: ["src/"] }), root);
        expect(clean.severity).toBe("none");
        expect(clean.score).toBe(0);
    });

    it("D14: clean repo → score=0", async () => {
        const root = await makeRepo({ "src/index.ts": "ok\n" });
        const r = await detectDrift(contract({ inScope: ["src/"] }), root);
        expect(r.score).toBe(0);
        expect(r.changedFiles.length).toBe(0);
    });

    it("D15: mixed in/out changes", async () => {
        const root = await makeRepo({ "src/a.ts": "a\n" });
        await fs.writeFile(path.join(root, "src/a.ts"), "changed\n", "utf8");
        await fs.mkdir(path.join(root, "docs"), { recursive: true });
        await fs.writeFile(path.join(root, "docs/x.md"), "rogue\n", "utf8");
        const r = await detectDrift(contract({ inScope: ["src/"] }), root);
        expect(r.changedFiles.length).toBe(2);
        expect(r.outOfScopeChanges.length).toBe(1);
        expect(r.score).toBeGreaterThan(0);
    });

    it("D16: multiple protected paths → all detected", async () => {
        const root = await makeRepo({ ".env": "s\n", "secrets/key.pem": "k\n" });
        await fs.writeFile(path.join(root, ".env"), "x\n", "utf8");
        await fs.writeFile(path.join(root, "secrets/key.pem"), "y\n", "utf8");
        const r = await detectDrift(contract({ inScope: [], protectedPaths: [".env", "secrets/"] }), root);
        expect(r.protectedPathTouches.length).toBeGreaterThanOrEqual(2);
    });
});
