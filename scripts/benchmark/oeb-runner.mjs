#!/usr/bin/env node
/**
 * oeb-runner.mjs — Salacia OEB Benchmark Runner (DEVELOPER TOOL ONLY)
 *
 * ⚠️  This runs 2x LLM calls per task (bare + scaffold).
 *     For measuring Salacia's value proposition, NOT for runtime use.
 *
 * Usage:
 *   node scripts/benchmark/oeb-runner.mjs \
 *     --model <model-id> --sample <sample.json> \
 *     --output <dir> [--limit N] [--timeout ms]
 */
import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildRealTaskPrompt } from "../public-benchmark-utils.mjs";

const execFileAsync = promisify(execFile);

// ─── Load SWE-bench instance ────────────────────────────────────────

async function loadInstance(cwd, dataset, instanceId) {
    try {
        const { stdout } = await execFileAsync(
            "python3",
            ["-c", `import json; from datasets import load_dataset; ds = load_dataset('${dataset}', split='test'); inst = [x for x in ds if x['instance_id'] == '${instanceId}']; print(json.dumps(inst[0]) if inst else '{}')`],
            { cwd, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 }
        );
        const parsed = JSON.parse(stdout.trim());
        return parsed.instance_id ? { ok: true, payload: parsed } : { ok: false, reason: "not found" };
    } catch (err) {
        return { ok: false, reason: err.message };
    }
}

// ─── Init workspace ─────────────────────────────────────────────────

async function initWorkspace(runDir, instance) {
    const wsPath = path.join(runDir, "workspace");
    await fs.mkdir(wsPath, { recursive: true });
    try {
        // Clone with minimal depth first, then fetch the specific commit
        await execFileAsync("git", ["clone", "--bare", "--filter=blob:none",
            `https://github.com/${instance.repo}.git`, wsPath + "/.git"],
            { timeout: 180_000, maxBuffer: 20 * 1024 * 1024 });
        await execFileAsync("git", ["config", "core.bare", "false"], { cwd: wsPath });
        // Fetch the specific base commit
        await execFileAsync("git", ["fetch", "origin", instance.base_commit, "--depth=1"],
            { cwd: wsPath, timeout: 120_000, maxBuffer: 20 * 1024 * 1024 });
        await execFileAsync("git", ["checkout", instance.base_commit],
            { cwd: wsPath, timeout: 60_000 });
        return { ok: true, path: wsPath };
    } catch (err) {
        return { ok: false, reason: err.message };
    }
}

// ─── Build test command from SWE-bench instance ─────────────────────

function buildTestCmd(instance) {
    // Use test_patch or FAIL_TO_PASS tests if available
    const failToPass = instance.FAIL_TO_PASS;
    if (failToPass) {
        try {
            const tests = JSON.parse(failToPass);
            if (Array.isArray(tests) && tests.length > 0) {
                return `python3 -m pytest -xvs ${tests.join(" ")}`;
            }
        } catch { /* not JSON */ }
    }
    // Fallback: generic pytest
    return "python3 -m pytest -x --timeout=60";
}

// ─── Run gate for one task ──────────────────────────────────────────

async function runGateForTask(model, wsPath, instance, timeoutMs, runDir) {
    const barePrompt = buildRealTaskPrompt(instance, wsPath, false);
    const scaffoldPrompt = buildRealTaskPrompt(instance, wsPath, true);
    const testCmd = buildTestCmd(instance);

    await fs.writeFile(path.join(runDir, "prompt-bare.txt"), barePrompt, "utf8");
    await fs.writeFile(path.join(runDir, "prompt-scaffold.txt"), scaffoldPrompt, "utf8");
    await fs.writeFile(path.join(runDir, "test-cmd.txt"), testCmd, "utf8");

    const gatePath = path.resolve("scripts/benchmark/oeb-gate.mjs");
    const outputPath = path.join(runDir, "gate-result.json");

    try {
        const { stdout, stderr } = await execFileAsync(
            "node",
            [gatePath, "--model", model, "--repo", wsPath,
                "--prompt-bare", path.join(runDir, "prompt-bare.txt"),
                "--prompt-scaffold", path.join(runDir, "prompt-scaffold.txt"),
                "--test-cmd", testCmd, "--timeout", String(timeoutMs),
                "--output", outputPath],
            { cwd: process.cwd(), timeout: timeoutMs * 3, maxBuffer: 20 * 1024 * 1024 }
        );
        if (stderr) console.error(stderr);
        if (existsSync(outputPath)) return JSON.parse(readFileSync(outputPath, "utf8"));
        return JSON.parse(stdout.trim());
    } catch (err) {
        // Gate may have written partial results before crashing
        if (existsSync(outputPath)) {
            try { return JSON.parse(readFileSync(outputPath, "utf8")); } catch { }
        }
        console.error(`[OEB] Gate error: ${err.stderr || err.message}`);
        return { gateResult: "error", gatePass: false, error: err.message };
    }
}

// ─── Aggregate (split metrics) ──────────────────────────────────────

function aggregate(results) {
    const n = results.length;
    if (!n) return {};

    const barePass = results.filter(r => r.bare?.testPassed).length;
    const scaffoldPass = results.filter(r => r.scaffold?.testPassed).length;
    const scaffoldWins = results.filter(r => r.gateResult === "scaffold-win").length;
    const fallbacks = results.filter(r => r.gateResult === "fallback-bare").length;
    const bothFails = results.filter(r => r.gateResult === "both-fail").length;
    const errors = results.filter(r => r.gateResult === "error").length;

    const totalBareTokens = results.reduce((s, r) => s + (r.bare?.tokens?.total_tokens || 0), 0);
    const totalScaffoldTokens = results.reduce((s, r) => s + (r.scaffold?.tokens?.total_tokens || 0), 0);

    const accBare = barePass / n;
    const accScaffold = scaffoldPass / n;

    // Split metrics — NOT multiplied together
    const accuracy_uplift = accBare > 0
        ? Math.round((accScaffold / accBare) * 100) / 100
        : (accScaffold > 0 ? "Infinity" : 1);
    const token_efficiency = totalScaffoldTokens > 0 ? Math.round((totalBareTokens / totalScaffoldTokens) * 100) / 100 : 1;

    // Gate pass = scaffold accuracy >= bare accuracy (never degrade)
    const gatePass = accScaffold >= accBare;

    return {
        total: n,
        accuracy: { bare: Math.round(accBare * 100), scaffold: Math.round(accScaffold * 100), delta: Math.round((accScaffold - accBare) * 100) },
        tokens: {
            avgBare: Math.round(totalBareTokens / n), avgScaffold: Math.round(totalScaffoldTokens / n),
            savingsPercent: totalBareTokens > 0 ? Math.round((1 - totalScaffoldTokens / totalBareTokens) * 100) : 0,
        },
        splitMetrics: { accuracy_uplift, token_efficiency },
        gateVerdict: { pass: gatePass, reason: gatePass ? "scaffold ≥ bare on accuracy" : "scaffold < bare on accuracy — GATE FAIL" },
        breakdown: { scaffoldWins, fallbacks, bothFails, errors },
    };
}

// ─── Markdown report ────────────────────────────────────────────────

function toMarkdown(model, m, results) {
    return [
        `# Salacia OEB Report — ${model}`,
        `> Benchmark only. Generated: ${new Date().toISOString()}`,
        "",
        "## Split Metrics",
        `| Metric | Value | Note |`,
        `|--------|-------|------|`,
        `| **Accuracy Uplift** | **${m.splitMetrics.accuracy_uplift}×** | scaffold_acc / bare_acc (≥1.0 = pass) |`,
        `| **Token Efficiency** | **${m.splitMetrics.token_efficiency}×** | bare_tokens / scaffold_tokens (>1 = saves tokens) |`,
        "",
        "## Accuracy",
        `| | Bare | Scaffold | Δ |`,
        `|--|------|----------|---|`,
        `| Pass Rate | ${m.accuracy.bare}% | ${m.accuracy.scaffold}% | ${m.accuracy.delta >= 0 ? "+" : ""}${m.accuracy.delta}% |`,
        `| Avg Tokens | ${m.tokens.avgBare} | ${m.tokens.avgScaffold} | ${m.tokens.savingsPercent >= 0 ? "-" : "+"}${Math.abs(m.tokens.savingsPercent)}% |`,
        "",
        m.gateVerdict.pass
            ? "> [!NOTE]\n> ✅ **Gate PASS**: " + m.gateVerdict.reason
            : "> [!WARNING]\n> ❌ **Gate FAIL**: " + m.gateVerdict.reason,
        "",
        "## Breakdown",
        `| Scaffold Win | Fallback Bare | Both Fail | Error |`,
        `|--------------|---------------|-----------|-------|`,
        `| ${m.breakdown.scaffoldWins} | ${m.breakdown.fallbacks} | ${m.breakdown.bothFails} | ${m.breakdown.errors} |`,
    ].join("\n");
}

// ─── CLI ────────────────────────────────────────────────────────────

async function main() {
    const args = process.argv.slice(2);
    let model = "google/gemini-3-flash-preview", samplePath = "", outputDir = "", limit = Infinity, timeoutMs = 300_000;

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case "--model": model = args[++i]; break;
            case "--sample": samplePath = args[++i]; break;
            case "--output": outputDir = args[++i]; break;
            case "--limit": limit = Number(args[++i]); break;
            case "--timeout": timeoutMs = Number(args[++i]); break;
        }
    }
    if (!samplePath) { console.error("--sample required"); process.exit(1); }
    if (!outputDir) outputDir = path.join(process.cwd(), ".salacia", "oeb", `oeb-${Date.now()}`);
    await fs.mkdir(outputDir, { recursive: true });

    const sample = JSON.parse(readFileSync(samplePath, "utf8"));
    const rawList = Array.isArray(sample)
        ? sample
        : (sample.instances || [sample]);
    const ids = rawList.map(s => typeof s === "string" ? s : s.instance_id).filter(Boolean).slice(0, limit);

    console.error(`[OEB] Model: ${model} | Tasks: ${ids.length} | Output: ${outputDir}`);

    const results = [];
    for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        console.error(`\n[OEB] ─── ${i + 1}/${ids.length}: ${id} ───`);
        const runDir = path.join(outputDir, `task-${i + 1}-${id.replace(/[/\\]/g, "__")}`);
        await fs.mkdir(runDir, { recursive: true });

        const inst = await loadInstance(process.cwd(), "princeton-nlp/SWE-bench_Verified", id);
        if (!inst.ok) { results.push({ instanceId: id, gateResult: "error", error: inst.reason }); continue; }

        const ws = await initWorkspace(runDir, inst.payload);
        if (!ws.ok) { results.push({ instanceId: id, gateResult: "error", error: ws.reason }); continue; }

        const gate = await runGateForTask(model, ws.path, inst.payload, timeoutMs, runDir);
        results.push({ instanceId: id, ...gate });
    }

    const metrics = aggregate(results);
    const report = { model, metrics, results, generatedAt: new Date().toISOString() };
    await fs.writeFile(path.join(outputDir, "oeb-report.json"), JSON.stringify(report, null, 2), "utf8");
    await fs.writeFile(path.join(outputDir, "oeb-report.md"), toMarkdown(model, metrics, results), "utf8");

    console.error(`\n[OEB] ═══ RESULT ═══`);
    console.error(`  Accuracy Uplift: ${metrics.splitMetrics.accuracy_uplift}× (≥1.0 = pass)`);
    console.error(`  Token Efficiency: ${metrics.splitMetrics.token_efficiency}× (>1 = saves tokens)`);
    console.error(`  Gate: ${metrics.gateVerdict.pass ? "✅ PASS" : "❌ FAIL"}`);
    console.log(JSON.stringify(report, null, 2));
    process.exit(metrics.gateVerdict.pass ? 0 : 1);
}

main().catch(err => { console.error("[Salacia] oeb-runner crashed:", err); process.exit(2); });
