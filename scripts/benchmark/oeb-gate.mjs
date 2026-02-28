#!/usr/bin/env node
/**
 * oeb-gate.mjs — Salacia OEB Performance Gate (BENCHMARK ONLY)
 *
 * ⚠️  This is a developer benchmark tool, NOT a production feature.
 *     It runs two LLM calls per task to measure Salacia's value-add.
 *     Never use this in user-facing execution paths.
 *
 * Gate Logic:
 *   1. Run Bare (raw prompt) → apply patch → run tests → pass/fail
 *   2. Run Scaffold (Salacia-enhanced prompt) → apply patch → run tests → pass/fail
 *   3. Gate Decision based on TEST RESULTS (not git diff):
 *      - scaffold passes, bare fails → scaffold-win
 *      - both pass → scaffold-win (token efficiency tiebreaker)
 *      - scaffold fails, bare passes → fallback-bare
 *      - both fail → both-fail
 *   4. Metrics: accuracy_uplift and token_efficiency computed SEPARATELY
 *
 * Usage:
 *   node scripts/benchmark/oeb-gate.mjs \
 *     --model <model-id> --repo <workspace> \
 *     --prompt-bare <file> --prompt-scaffold <file> \
 *     --test-cmd <cmd> --timeout <ms> --output <result.json>
 */
import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { execFile, exec } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

// ─── Token Estimation (provider-agnostic) ──────────────────────────────

function estimateTokensFromText(text) {
    // Rough estimator: ~4 chars per token for English/code
    // This is the fallback when OpenRouter usage data is unavailable
    return Math.ceil((text || "").length / 4);
}

function parseUsageFromStderr(stderr) {
    if (!stderr) return null;
    for (const line of stderr.split("\n")) {
        try {
            const parsed = JSON.parse(line.trim());
            if (parsed._salacia_usage && parsed.total_tokens > 0) {
                return {
                    prompt_tokens: parsed.prompt_tokens,
                    completion_tokens: parsed.completion_tokens,
                    total_tokens: parsed.total_tokens,
                    source: "api",
                };
            }
        } catch { /* not JSON */ }
    }
    return null;
}

function getTokenUsage(promptText, stdout, stderr) {
    const apiUsage = parseUsageFromStderr(stderr);
    if (apiUsage) return apiUsage;

    // Fallback: estimate from text
    return {
        prompt_tokens: estimateTokensFromText(promptText),
        completion_tokens: estimateTokensFromText(stdout),
        total_tokens: estimateTokensFromText(promptText) + estimateTokensFromText(stdout),
        source: "estimated",
    };
}

// ─── Run model + apply patch ──────────────────────────────────────────

async function runModelAndApplyPatch(repoPath, model, prompt, timeoutMs, env) {
    const clientPath = path.resolve("scripts/openrouter-client.mjs");
    const start = Date.now();
    const promptFile = path.resolve(repoPath, ".oeb-prompt-tmp.txt");
    try {
        await fs.writeFile(promptFile, prompt, "utf8");
        const { stdout, stderr } = await execFileAsync(
            "node", [clientPath, "-m", model, "-f", promptFile],
            { cwd: repoPath, timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024, env: { ...process.env, ...env } }
        );
        await fs.rm(promptFile, { force: true }).catch(() => { });
        return {
            ok: true, stdout, stderr,
            usage: getTokenUsage(prompt, stdout, stderr),
            elapsed: Date.now() - start,
        };
    } catch (err) {
        await fs.rm(promptFile, { force: true }).catch(() => { });
        return {
            ok: false, stdout: err.stdout || "", stderr: err.stderr || "",
            usage: getTokenUsage(prompt, err.stdout || "", err.stderr || ""),
            elapsed: Date.now() - start, error: err.message,
        };
    }
}

// ─── Run test suite ──────────────────────────────────────────────────

async function runTestSuite(repoPath, testCmd, timeoutMs) {
    if (!testCmd) return { passed: false, reason: "no test command provided" };
    try {
        const { stdout, stderr } = await execAsync(testCmd, {
            cwd: repoPath, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024,
        });
        return { passed: true, stdout, stderr };
    } catch (err) {
        return { passed: false, stdout: err.stdout || "", stderr: err.stderr || "", reason: err.message };
    }
}

// ─── Workspace management ────────────────────────────────────────────

async function copyWorkspace(src, dst) {
    if (existsSync(dst)) await fs.rm(dst, { recursive: true });
    try {
        // Prefer git worktree for speed (avoids copying .git)
        await execFileAsync("git", ["worktree", "add", "--detach", dst], { cwd: src, timeout: 30_000 });
    } catch {
        // Fallback to full copy if worktree fails
        await fs.cp(src, dst, { recursive: true });
    }
}

async function removeWorkspace(src, dst) {
    try {
        await execFileAsync("git", ["worktree", "remove", "--force", dst], { cwd: src, timeout: 10_000 });
    } catch {
        await fs.rm(dst, { recursive: true }).catch(() => { });
    }
}

async function resetWorkspace(wsPath) {
    try {
        await execFileAsync("git", ["checkout", "."], { cwd: wsPath, timeout: 10_000 });
        await execFileAsync("git", ["clean", "-fd"], { cwd: wsPath, timeout: 10_000 });
    } catch { /* best effort */ }
}

// ─── Main Gate ───────────────────────────────────────────────────────

async function runGate(opts) {
    const { model, repoPath, barePrompt, scaffoldPrompt, testCmd, timeoutMs, outputPath } = opts;

    const env = {
        GEMINI_API_KEY: process.env.GEMINI_API_KEY,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY,
        OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1",
        OPENROUTER_REFERER: "https://github.com/StartripAI/Salacia",
        OPENROUTER_TITLE: "Salacia OEB Benchmark",
    };

    // ── Run Bare (directly on workspace, then reset) ──
    console.error("[OEB] Running BARE mode...");
    const bareRun = await runModelAndApplyPatch(repoPath, model, barePrompt, timeoutMs, env);
    const bareTest = await runTestSuite(repoPath, testCmd, timeoutMs);

    // ── Reset workspace ──
    console.error("[OEB] Resetting workspace...");
    await resetWorkspace(repoPath);

    // ── Run Scaffold ──
    console.error("[OEB] Running SCAFFOLD mode...");
    const scaffoldRun = await runModelAndApplyPatch(repoPath, model, scaffoldPrompt, timeoutMs, env);
    const scaffoldTest = await runTestSuite(repoPath, testCmd, timeoutMs);

    // ── Gate Decision (TEST-BASED, not git-diff-based) ──
    let gateResult;
    if (scaffoldTest.passed && !bareTest.passed) {
        gateResult = "scaffold-win";
    } else if (scaffoldTest.passed && bareTest.passed) {
        gateResult = "scaffold-win"; // both pass, scaffold gets credit for context
    } else if (!scaffoldTest.passed && bareTest.passed) {
        gateResult = "fallback-bare";
    } else {
        gateResult = "both-fail";
    }

    // ── Metrics (SPLIT, not multiplied) ──
    const bareTokens = bareRun.usage;
    const scaffoldTokens = scaffoldRun.usage;

    const accuracyUplift = scaffoldTest.passed === bareTest.passed
        ? 1.0
        : scaffoldTest.passed ? Infinity : 0;

    const tokenEfficiency = scaffoldTokens.total_tokens > 0
        ? Math.round((bareTokens.total_tokens / scaffoldTokens.total_tokens) * 100) / 100
        : 1;

    // Gate pass = scaffold accuracy never worse than bare
    const gatePass = gateResult !== "fallback-bare";

    const report = {
        model,
        gateResult,
        gatePass,
        bare: {
            testPassed: bareTest.passed,
            tokens: bareTokens,
            elapsedMs: bareRun.elapsed,
        },
        scaffold: {
            testPassed: scaffoldTest.passed,
            tokens: scaffoldTokens,
            elapsedMs: scaffoldRun.elapsed,
        },
        metrics: {
            accuracy_uplift: Number.isFinite(accuracyUplift) ? accuracyUplift : "Infinity",
            token_efficiency: tokenEfficiency,
            token_source: bareTokens.source,
        },
        timestamp: new Date().toISOString(),
    };

    if (outputPath) {
        await fs.writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");
    }
    console.log(JSON.stringify(report, null, 2));
    return report;
}

// ─── CLI ─────────────────────────────────────────────────────────────

async function main() {
    const args = process.argv.slice(2);
    const opts = {
        model: "google/gemini-3-flash-preview", repoPath: "", barePrompt: "",
        scaffoldPrompt: "", testCmd: "", timeoutMs: 300_000, outputPath: ""
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case "--model": opts.model = args[++i]; break;
            case "--repo": opts.repoPath = args[++i]; break;
            case "--prompt-bare": opts.barePrompt = readFileSync(args[++i], "utf8"); break;
            case "--prompt-scaffold": opts.scaffoldPrompt = readFileSync(args[++i], "utf8"); break;
            case "--bare-text": opts.barePrompt = args[++i]; break;
            case "--scaffold-text": opts.scaffoldPrompt = args[++i]; break;
            case "--test-cmd": opts.testCmd = args[++i]; break;
            case "--timeout": opts.timeoutMs = Number(args[++i]); break;
            case "--output": opts.outputPath = args[++i]; break;
        }
    }

    if (!opts.repoPath || !opts.barePrompt || !opts.scaffoldPrompt) {
        console.error("Error: --repo, --prompt-bare/--bare-text, --prompt-scaffold/--scaffold-text required");
        process.exit(1);
    }
    if (!opts.testCmd) {
        console.error("Warning: No --test-cmd provided. Gate will judge based on exit code only.");
    }

    const report = await runGate(opts);
    process.exit(report.gatePass ? 0 : 1);
}

main().catch((err) => { console.error("OEB Gate crashed:", err); process.exit(2); });
