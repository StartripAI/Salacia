#!/usr/bin/env node
/**
 * oeb-local-ab.mjs — Local A/B Test Runner for Salacia OEB
 *
 * Uses pre-built workspaces from /tmp/salacia-oeb/ws2-* to avoid cloning.
 * Runs 2 LLM calls per task: bare (raw prompt) vs scaffold (Salacia-enhanced).
 * Then applies the generated diff and runs tests using run_50.py's exact test logic.
 *
 * Usage:
 *   GEMINI_API_KEY=sk-... node scripts/benchmark/oeb-local-ab.mjs \
 *     --model google/gemini-2.5-flash-preview \
 *     --sample /tmp/salacia-oeb/oeb-sample-45.json \
 *     --limit 5 --output /tmp/salacia-oeb/ab-results
 */
import fs from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFile, exec } from "node:child_process";
import { promisify } from "node:util";
import { buildRealTaskPrompt } from "../public-benchmark-utils.mjs";
import { META, WS_PREFIX, VENVS, REPO_CONFIG, defaultOutputDir } from "./bench-config.mjs";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

// Repo config imported from bench-config.mjs
const VENV_OVERRIDE = {
    "sympy__sympy-13551": "sympy39",
    "pylint-dev__pylint-6903": "pylint39",
    "pylint-dev__pylint-7277": "pylint7277",
};

const C_EXT_REPOS = new Set(["matplotlib", "scikit-learn", "astropy"]);
const EDITABLE_REPOS = { pallets: "flask", psf: "requests39", "pytest-dev": "pytest39", "sphinx-doc": "sphinx39" };
const EDITABLE_TASK = { "pylint-dev__pylint-6903": "pylint39", "pylint-dev__pylint-7277": "pylint7277" };

function getConfig(tid) {
    return REPO_CONFIG[tid.split("__")[0]] || REPO_CONFIG.django;
}

// ─── Reset workspace ────────────────────────────────────────────────────
async function resetWs(ws) {
    await execFileAsync("git", ["checkout", "."], { cwd: ws, timeout: 10_000 }).catch(() => { });
    await execFileAsync("git", ["clean", "-fd"], { cwd: ws, timeout: 10_000 }).catch(() => { });
}

// ─── Build C extensions ─────────────────────────────────────────────────
async function buildExt(py, ws, tid) {
    const env = {
        ...process.env,
        SKLEARN_NO_OPENMP: "1",
        CFLAGS: "-Wno-error -Wno-implicit-function-declaration -Wno-incompatible-function-pointer-types -Wno-int-conversion -I/opt/homebrew/include",
        LDFLAGS: "-L/opt/homebrew/lib",
        PKG_CONFIG_PATH: "/opt/homebrew/lib/pkgconfig",
    };
    if (tid.includes("matplotlib")) {
        const cfgPath = existsSync(`${ws}/mplsetup.cfg.template`) || existsSync(`${ws}/mplsetup.cfg`)
            ? `${ws}/mplsetup.cfg` : `${ws}/setup.cfg`;
        writeFileSync(cfgPath, "[libs]\nsystem_freetype = true\nsystem_qhull = true\n");
    }
    await execFileAsync(py, ["setup.py", "build_ext", "--inplace"],
        { cwd: ws, timeout: 600_000, maxBuffer: 50 * 1024 * 1024, env }).catch(() => { });
}

// ─── Reinstall editable ─────────────────────────────────────────────────
async function reinstall(tid, venv) {
    const ws = WS_PREFIX + tid;
    const pip = `${VENVS}/${venv}/bin/pip`;
    const r = await execFileAsync(pip, ["install", "-e", "."],
        { cwd: ws, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 }).catch(() => ({ code: 1 }));
    if (r.code) {
        await execFileAsync(pip, ["install", "."],
            { cwd: ws, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 }).catch(() => { });
    }
}

// ─── Apply a patch file ─────────────────────────────────────────────────
async function applyPatchFile(ws, patchPath) {
    const r = await execFileAsync("git", ["apply", patchPath],
        { cwd: ws, timeout: 10_000 }).catch(() => ({ code: 1 }));
    if (r.code) {
        await execFileAsync("git", ["apply", "--3way", patchPath],
            { cwd: ws, timeout: 10_000 }).catch(() => { });
    }
}

// ─── Apply a diff string to workspace ───────────────────────────────────
async function applyDiffString(ws, diff) {
    if (!diff) return false;
    // Normalize: ensure diff has proper --- a/ and +++ b/ lines
    let normalized = diff;
    if (!normalized.includes("--- a/") && !normalized.includes("--- original/")) {
        // Try to extract just the diff part
        const lines = normalized.split("\n");
        const start = lines.findIndex(l => l.startsWith("---") || l.startsWith("diff --git"));
        if (start > 0) normalized = lines.slice(start).join("\n");
    }
    if (!normalized.includes("---")) return false;

    const tmpPath = path.join(ws, `.oeb-ab-${Date.now()}.diff`);
    writeFileSync(tmpPath, normalized);
    try {
        // Try: exact git apply
        try { await execFileAsync("git", ["apply", tmpPath], { cwd: ws, timeout: 10_000 }); return true; } catch { }
        // Try: git apply with recount (fixes wrong line counts)
        try { await execFileAsync("git", ["apply", "--recount", tmpPath], { cwd: ws, timeout: 10_000 }); return true; } catch { }
        // Try: git apply with 3-way merge
        try { await execFileAsync("git", ["apply", "--3way", tmpPath], { cwd: ws, timeout: 10_000 }); return true; } catch { }
        // Try: git apply ignoring whitespace
        try { await execFileAsync("git", ["apply", "--ignore-whitespace", "--recount", tmpPath], { cwd: ws, timeout: 10_000 }); return true; } catch { }
        // Try: patch with fuzz
        try { await execAsync(`patch --batch --fuzz=3 -p1 < ${tmpPath}`, { cwd: ws, timeout: 10_000 }); return true; } catch { }
        // Try: patch with fuzz and ignore whitespace
        try { await execAsync(`patch --batch --fuzz=10 -l -p1 < ${tmpPath}`, { cwd: ws, timeout: 10_000 }); return true; } catch { }
        return false;
    } finally {
        try { await fs.rm(tmpPath); } catch { }
    }
}

// ─── Run test (same logic as run_50.py) ─────────────────────────────────
async function runTest(py, ws, labels, config, tid) {
    const env = { ...process.env };
    delete env.PYTHONPATH;
    if (config.pp === "workspace") env.PYTHONPATH = ws;
    else if (config.pp === "workspace_lib") env.PYTHONPATH = `${ws}/lib`;
    env.MPLBACKEND = "agg";

    for (const label of labels) {
        try {
            let cmd;
            if (config.testMode === "runtests") {
                // Django: parse label
                let fl = label;
                if (label.includes("(")) {
                    const m = label.split("(")[0].trim();
                    if (m.startsWith("test_")) {
                        fl = `${label.split("(")[1].replace(")", "").trim()}.${m}`;
                    }
                } else if (!label.startsWith("test_")) {
                    // Extract from test patch
                    const tp = readFileSync(`${META}/${tid}/test-patch.diff`, "utf8");
                    const m = tp.match(/diff --git a\/tests\/(.+?)\.py b\//);
                    if (m) fl = m[1].replace(/\//g, ".");
                }
                const r = await execAsync(`${py} ${ws}/tests/runtests.py ${fl} --verbosity=0`,
                    { cwd: ws, timeout: 120_000, maxBuffer: 10 * 1024 * 1024, env });
                if (r.stderr.includes("FAILED")) return false;
            } else if (config.testMode === "direct") {
                const { stdout: loc } = await execAsync(`grep -rl 'def ${label}\\b' ${ws}`,
                    { timeout: 10_000 }).catch(() => ({ stdout: "" }));
                if (!loc.trim()) return false;
                const tf = loc.trim().split("\n")[0];
                const mp = tf.replace(ws + "/", "").replace(/\//g, ".").replace(".py", "");
                await execAsync(`${py} -c "import ${mp}; ${mp}.${label}(); print('OK')"`,
                    { cwd: ws, timeout: 120_000, env });
            } else if (config.testMode === "pytest_mpl") {
                cmd = `${py} -m pytest -xvs --override-ini=addopts= -W ignore::DeprecationWarning -p no:cacheprovider ${label}`;
            } else if (config.testMode === "pytest_astropy") {
                cmd = `${py} -m pytest -xvs --override-ini=addopts= -p no:cacheprovider ${label}`;
            } else if (config.testMode === "pytest_sklearn") {
                cmd = `${py} -m pytest -xvs --override-ini=addopts= --no-header -p no:cacheprovider ${label}`;
            } else {
                cmd = label.includes("::")
                    ? `${py} -m pytest -xvs --no-header -p no:cacheprovider ${label}`
                    : `${py} -m pytest -xvs -k ${label}`;
            }
            if (cmd) {
                await execAsync(cmd, { cwd: ws, timeout: 120_000, maxBuffer: 10 * 1024 * 1024, env });
            }
        } catch {
            return false;
        }
    }
    return true;
}

// ─── Call OpenRouter LLM ────────────────────────────────────────────────
async function callLLM(model, prompt, apiKey) {
    const baseUrl = process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1";
    const start = Date.now();

    const enhancedPrompt = `${prompt}\n\nIMPORTANT: Return your fix ONLY as a standard Unified Diff inside a \`\`\`diff code block. Ensure paths start with 'a/' and 'b/'.`;

    try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
                "HTTP-Referer": "https://github.com/StartripAI/Salacia",
                "X-Title": "Salacia OEB A/B Test",
            },
            body: JSON.stringify({ model, messages: [{ role: "user", content: enhancedPrompt }] }),
        });
        if (!response.ok) {
            const errText = await response.text();
            return { ok: false, error: `${response.status}: ${errText.slice(0, 200)}`, elapsed: Date.now() - start, tokens: {} };
        }
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || "";
        const usage = data.usage || {};
        const diffMatch = content.match(/```(?:diff|patch)?\n([\s\S]*?)```/);
        const diff = diffMatch ? diffMatch[1] : (content.includes("--- a/") ? content : null);
        return {
            ok: true, content, diff,
            tokens: { prompt: usage.prompt_tokens || 0, completion: usage.completion_tokens || 0, total: usage.total_tokens || 0 },
            elapsed: Date.now() - start,
        };
    } catch (err) {
        return { ok: false, error: err.message, elapsed: Date.now() - start, tokens: {} };
    }
}

// ─── Build prompts ──────────────────────────────────────────────────────
function buildPrompts(tid, ws) {
    // Load problem statement from meta
    const instancePath = `${META}/${tid}/instance.json`;
    let instance;
    if (existsSync(instancePath)) {
        instance = JSON.parse(readFileSync(instancePath, "utf8"));
    } else {
        // Minimal instance from local meta
        const problemPath = `${META}/${tid}/problem.txt`;
        const problem = existsSync(problemPath) ? readFileSync(problemPath, "utf8") : `Fix the issue in ${tid}`;
        instance = { instance_id: tid, problem_statement: problem, hints_text: "" };
    }

    // Bare prompt: just the issue
    const bare = [
        instance.problem_statement || `Fix the issue described in ${tid}`,
        "",
        "Minimal execution rules:",
        "- Apply the fix directly in repository:",
        `  ${ws}`,
        "- Keep edits focused on this issue only.",
        "- Keep modifications unstaged in git working tree.",
        "- Return after patch is complete.",
    ].join("\n");

    // Scaffold prompt: Salacia-enhanced
    const scaffold = buildRealTaskPrompt(instance, ws, true);

    return { bare, scaffold, instance };
}

// ─── Main ───────────────────────────────────────────────────────────────
async function main() {
    const args = process.argv.slice(2);
    let model = "google/gemini-2.5-flash-preview";
    let samplePath = "";
    let outputDir = "";
    let limit = Infinity;
    let timeoutMs = 300_000;

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case "--model": model = args[++i]; break;
            case "--sample": samplePath = args[++i]; break;
            case "--output": outputDir = args[++i]; break;
            case "--limit": limit = Number(args[++i]); break;
            case "--timeout": timeoutMs = Number(args[++i]); break;
        }
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) { console.error("❌ API key required: set GEMINI_API_KEY, OPENROUTER_API_KEY, or OPENAI_API_KEY"); process.exit(1); }
    if (!samplePath) { console.error("--sample required"); process.exit(1); }
    if (!outputDir) outputDir = defaultOutputDir("ab");
    await fs.mkdir(outputDir, { recursive: true });

    const sample = JSON.parse(readFileSync(samplePath, "utf8"));
    const ids = sample.map(s => typeof s === "string" ? s : s.instance_id).filter(Boolean).slice(0, limit);

    console.error(`[OEB A/B] Model: ${model} | Tasks: ${ids.length} | Output: ${outputDir}`);
    console.error(`[OEB A/B] Using local workspaces from ${WS_PREFIX}*\n`);

    const results = [];

    for (let i = 0; i < ids.length; i++) {
        const tid = ids[i];
        const ws = WS_PREFIX + tid;
        if (!existsSync(ws)) {
            console.error(`[${i + 1}/${ids.length}] ${tid} — SKIP (no workspace)`);
            results.push({ instanceId: tid, gateResult: "error", error: "no workspace" });
            continue;
        }

        const config = getConfig(tid);
        const prefix = tid.split("__")[0];
        const venv = VENV_OVERRIDE[tid] || config.venv;
        const py = `${VENVS}/${venv}/bin/python3`;
        const f2p = JSON.parse(readFileSync(`${META}/${tid}/fail-to-pass.txt`, "utf8"));

        console.error(`\n[${i + 1}/${ids.length}] ─── ${tid} ───`);

        const { bare: barePrompt, scaffold: scaffoldPrompt } = buildPrompts(tid, ws);
        const taskDir = path.join(outputDir, `task-${i + 1}-${tid.replace(/[/\\]/g, "__")}`);
        await fs.mkdir(taskDir, { recursive: true });
        await fs.writeFile(path.join(taskDir, "prompt-bare.txt"), barePrompt, "utf8");
        await fs.writeFile(path.join(taskDir, "prompt-scaffold.txt"), scaffoldPrompt, "utf8");

        // ── BARE RUN ──
        console.error("  [BARE] Calling LLM...");
        const bareLLM = await callLLM(model, barePrompt, apiKey);
        let bareTestPassed = false;
        if (bareLLM.ok && bareLLM.diff) {
            await resetWs(ws);
            await applyPatchFile(ws, `${META}/${tid}/test-patch.diff`);
            if (C_EXT_REPOS.has(prefix)) await buildExt(py, ws, tid);
            const applied = await applyDiffString(ws, bareLLM.diff);
            if (EDITABLE_TASK[tid]) await reinstall(tid, EDITABLE_TASK[tid]);
            else if (EDITABLE_REPOS[prefix]) await reinstall(tid, EDITABLE_REPOS[prefix]);
            if (applied) bareTestPassed = await runTest(py, ws, f2p, config, tid);
            console.error(`  [BARE] ${applied ? (bareTestPassed ? "✅ PASS" : "❌ FAIL") : "⚠️ patch not applied"}`);
        } else {
            console.error(`  [BARE] ${bareLLM.ok ? "⚠️ no diff in response" : `❌ API error: ${bareLLM.error?.slice(0, 80)}`}`);
        }
        await fs.writeFile(path.join(taskDir, "bare-response.txt"), bareLLM.content || bareLLM.error || "", "utf8");

        // ── SCAFFOLD RUN ──
        console.error("  [SCAFFOLD] Calling LLM...");
        const scaffoldLLM = await callLLM(model, scaffoldPrompt, apiKey);
        let scaffoldTestPassed = false;
        if (scaffoldLLM.ok && scaffoldLLM.diff) {
            await resetWs(ws);
            await applyPatchFile(ws, `${META}/${tid}/test-patch.diff`);
            if (C_EXT_REPOS.has(prefix)) await buildExt(py, ws, tid);
            const applied = await applyDiffString(ws, scaffoldLLM.diff);
            if (EDITABLE_TASK[tid]) await reinstall(tid, EDITABLE_TASK[tid]);
            else if (EDITABLE_REPOS[prefix]) await reinstall(tid, EDITABLE_REPOS[prefix]);
            if (applied) scaffoldTestPassed = await runTest(py, ws, f2p, config, tid);
            console.error(`  [SCAFFOLD] ${applied ? (scaffoldTestPassed ? "✅ PASS" : "❌ FAIL") : "⚠️ patch not applied"}`);
        } else {
            console.error(`  [SCAFFOLD] ${scaffoldLLM.ok ? "⚠️ no diff in response" : `❌ API error: ${scaffoldLLM.error?.slice(0, 80)}`}`);
        }
        await fs.writeFile(path.join(taskDir, "scaffold-response.txt"), scaffoldLLM.content || scaffoldLLM.error || "", "utf8");

        // ── Gate Decision ──
        let gateResult;
        if (scaffoldTestPassed && !bareTestPassed) gateResult = "scaffold-win";
        else if (scaffoldTestPassed && bareTestPassed) gateResult = "both-pass";
        else if (!scaffoldTestPassed && bareTestPassed) gateResult = "fallback-bare";
        else gateResult = "both-fail";

        const result = {
            instanceId: tid, gateResult,
            bare: { testPassed: bareTestPassed, tokens: bareLLM.tokens, elapsed: bareLLM.elapsed },
            scaffold: { testPassed: scaffoldTestPassed, tokens: scaffoldLLM.tokens, elapsed: scaffoldLLM.elapsed },
        };
        results.push(result);
        await fs.writeFile(path.join(taskDir, "result.json"), JSON.stringify(result, null, 2), "utf8");

        // Reset workspace for next task
        await resetWs(ws);

        const icon = gateResult === "scaffold-win" ? "🏆" :
            gateResult === "both-pass" ? "✅" :
                gateResult === "fallback-bare" ? "⚠️" : "❌";
        console.error(`  ${icon} ${gateResult} | bare=${bareTestPassed ? "✅" : "❌"} scaffold=${scaffoldTestPassed ? "✅" : "❌"}`);
    }

    // ── Aggregate ──
    const n = results.length;
    const barePass = results.filter(r => r.bare?.testPassed).length;
    const scaffoldPass = results.filter(r => r.scaffold?.testPassed).length;
    const scaffoldWins = results.filter(r => r.gateResult === "scaffold-win").length;
    const bothPass = results.filter(r => r.gateResult === "both-pass").length;
    const fallbacks = results.filter(r => r.gateResult === "fallback-bare").length;
    const bothFails = results.filter(r => r.gateResult === "both-fail").length;

    const totalBareTokens = results.reduce((s, r) => s + (r.bare?.tokens?.total || 0), 0);
    const totalScaffoldTokens = results.reduce((s, r) => s + (r.scaffold?.tokens?.total || 0), 0);

    const accBare = n > 0 ? barePass / n : 0;
    const accScaffold = n > 0 ? scaffoldPass / n : 0;
    const uplift = accBare > 0 ? Math.round((accScaffold / accBare) * 100) / 100 : (accScaffold > 0 ? "∞" : 1);
    const tokenEff = totalScaffoldTokens > 0 ? Math.round((totalBareTokens / totalScaffoldTokens) * 100) / 100 : 1;

    const report = {
        model, tasks: n, generatedAt: new Date().toISOString(),
        accuracy: { bare: `${Math.round(accBare * 100)}%`, scaffold: `${Math.round(accScaffold * 100)}%`, delta: `${Math.round((accScaffold - accBare) * 100)}%` },
        tokens: { avgBare: n > 0 ? Math.round(totalBareTokens / n) : 0, avgScaffold: n > 0 ? Math.round(totalScaffoldTokens / n) : 0 },
        metrics: { accuracy_uplift: uplift, token_efficiency: tokenEff },
        breakdown: { scaffoldWins, bothPass, fallbacks, bothFails },
        results,
    };

    await fs.writeFile(path.join(outputDir, "oeb-ab-report.json"), JSON.stringify(report, null, 2), "utf8");

    // ── Markdown report ──
    const md = [
        `# Salacia OEB A/B Report — ${model}`,
        `> ${new Date().toISOString()} | ${n} tasks`,
        "",
        "## Results",
        "| Metric | Bare | Scaffold | Δ |",
        "|--------|------|----------|---|",
        `| **Pass Rate** | ${Math.round(accBare * 100)}% (${barePass}/${n}) | ${Math.round(accScaffold * 100)}% (${scaffoldPass}/${n}) | ${accScaffold >= accBare ? "+" : ""}${Math.round((accScaffold - accBare) * 100)}% |`,
        `| **Avg Tokens** | ${report.tokens.avgBare} | ${report.tokens.avgScaffold} | ${totalBareTokens > totalScaffoldTokens ? "saves" : "uses more"} |`,
        "",
        "## Metrics",
        `| Metric | Value |`,
        `|--------|-------|`,
        `| **Accuracy Uplift** | **${uplift}×** |`,
        `| **Token Efficiency** | **${tokenEff}×** |`,
        "",
        "## Breakdown",
        `| 🏆 Scaffold Win | ✅ Both Pass | ⚠️ Fallback Bare | ❌ Both Fail |`,
        `|-----------------|-------------|------------------|------------|`,
        `| ${scaffoldWins} | ${bothPass} | ${fallbacks} | ${bothFails} |`,
        "",
        accScaffold >= accBare
            ? "> [!NOTE]\n> ✅ **Gate PASS**: Scaffold ≥ Bare on accuracy"
            : "> [!WARNING]\n> ❌ **Gate FAIL**: Scaffold < Bare on accuracy",
    ].join("\n");

    await fs.writeFile(path.join(outputDir, "oeb-ab-report.md"), md, "utf8");

    console.error(`\n${"═".repeat(60)}`);
    console.error(`OEB A/B RESULTS (${model})`);
    console.error(`${"═".repeat(60)}`);
    console.error(`Bare:     ${barePass}/${n} (${Math.round(accBare * 100)}%)`);
    console.error(`Scaffold: ${scaffoldPass}/${n} (${Math.round(accScaffold * 100)}%)`);
    console.error(`Uplift:   ${uplift}×`);
    console.error(`Token Eff: ${tokenEff}×`);
    console.error(`Gate:     ${accScaffold >= accBare ? "✅ PASS" : "❌ FAIL"}`);
    console.error(`Report:   ${outputDir}/oeb-ab-report.md`);
}

main().catch(err => { console.error("[Salacia] oeb-local-ab crashed:", err); process.exit(2); });
