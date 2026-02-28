#!/usr/bin/env node
/**
 * oeb-agent-ab.mjs — Multi-turn Agent A/B Test for Salacia OEB
 *
 * Instead of single-shot diff generation, gives the LLM tools to:
 *   read_file, list_dir, grep_search, edit_file, run_tests
 * and lets it loop until tests pass (or max turns reached).
 *
 * Compares Bare (raw problem) vs Scaffold (Salacia-enhanced context).
 *
 * Usage:
 *   GEMINI_API_KEY=sk-or-xxx node scripts/benchmark/oeb-agent-ab.mjs \
 *     --model google/gemini-3-flash-preview \
 *     --sample /tmp/salacia-oeb/oeb-sample-45.json \
 *     --limit 5 --max-turns 8 --output /tmp/salacia-oeb/ab-agent
 */
import fs from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { execFile, exec, execFileSync, execSync } from "node:child_process";
import { promisify } from "node:util";
import { META, WS_PREFIX, VENVS, FL_PATH, REPO_CONFIG, getRepoConfig, defaultOutputDir } from "./bench-config.mjs";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

// Repo config imported from bench-config.mjs
const VENV_OVERRIDE = {
    "sympy__sympy-13551": "sympy39",
    "pylint-dev__pylint-6903": "pylint39",
    "pylint-dev__pylint-7277": "pylint7277",
};
const EDITABLE_REPOS = { pallets: "flask", psf: "requests39", "pytest-dev": "pytest39", "sphinx-doc": "sphinx39" };
const EDITABLE_TASK = { "pylint-dev__pylint-6903": "pylint39", "pylint-dev__pylint-7277": "pylint7277" };

// ─── Tool Definitions ───────────────────────────────────────────────────
// OpenAI-compatible format (for OpenRouter)
const TOOLS_OPENAI = [
    { type: "function", function: { name: "read_file", description: "Read the contents of a file in the repository. Returns the file content with line numbers. Use this to understand existing code before making changes.", parameters: { type: "object", properties: { path: { type: "string", description: "Relative path to the file from the repository root" }, start_line: { type: "integer", description: "Optional start line (1-indexed)" }, end_line: { type: "integer", description: "Optional end line (1-indexed). Max 200 lines per call." } }, required: ["path"] } } },
    { type: "function", function: { name: "list_dir", description: "List files and directories in a path.", parameters: { type: "object", properties: { path: { type: "string", description: "Relative directory path from repo root" } }, required: ["path"] } } },
    { type: "function", function: { name: "grep_search", description: "Search for a text pattern in the repository. Returns matching lines with file paths and line numbers.", parameters: { type: "object", properties: { pattern: { type: "string", description: "Text pattern to search for" }, path: { type: "string", description: "Optional: limit search to this directory or file" }, include: { type: "string", description: "Optional: file glob pattern, e.g. '*.py'" } }, required: ["pattern"] } } },
    { type: "function", function: { name: "edit_file", description: "Replace exact text in a file. The old_text must match EXACTLY (including whitespace and indentation). Use read_file first to see the exact content.", parameters: { type: "object", properties: { path: { type: "string", description: "Relative file path from repo root" }, old_text: { type: "string", description: "Exact text to find and replace. Must match character-for-character." }, new_text: { type: "string", description: "Replacement text" } }, required: ["path", "old_text", "new_text"] } } },
    { type: "function", function: { name: "run_tests", description: "Run the test suite for the current task. Returns test output (pass/fail and any error messages). Call this after making edits to verify your fix works.", parameters: { type: "object", properties: {}, required: [] } } },
];

// Anthropic-native format (for Anthropic proxies that require 'custom' type)
const TOOLS_ANTHROPIC = [
    { type: "custom", name: "read_file", description: "Read the contents of a file in the repository. Returns the file content with line numbers. Use this to understand existing code before making changes.", input_schema: { type: "object", properties: { path: { type: "string", description: "Relative path to the file from the repository root" }, start_line: { type: "integer", description: "Optional start line (1-indexed)" }, end_line: { type: "integer", description: "Optional end line (1-indexed). Max 200 lines per call." } }, required: ["path"] } },
    { type: "custom", name: "list_dir", description: "List files and directories in a path.", input_schema: { type: "object", properties: { path: { type: "string", description: "Relative directory path from repo root" } }, required: ["path"] } },
    { type: "custom", name: "grep_search", description: "Search for a text pattern in the repository. Returns matching lines with file paths and line numbers.", input_schema: { type: "object", properties: { pattern: { type: "string", description: "Text pattern to search for" }, path: { type: "string", description: "Optional: limit search to this directory or file" }, include: { type: "string", description: "Optional: file glob pattern, e.g. '*.py'" } }, required: ["pattern"] } },
    { type: "custom", name: "edit_file", description: "Replace exact text in a file. The old_text must match EXACTLY (including whitespace and indentation). Use read_file first to see the exact content.", input_schema: { type: "object", properties: { path: { type: "string", description: "Relative file path from repo root" }, old_text: { type: "string", description: "Exact text to find and replace. Must match character-for-character." }, new_text: { type: "string", description: "Replacement text" } }, required: ["path", "old_text", "new_text"] } },
    { type: "custom", name: "run_tests", description: "Run the test suite for the current task. Returns test output. Call after making edits to verify your fix.", input_schema: { type: "object", properties: {}, required: [] } },
];

// Are we using Anthropic proxy?
const IS_ANTHROPIC = !!process.env.ANTHROPIC_BASE_URL;
const TOOLS = IS_ANTHROPIC ? TOOLS_ANTHROPIC : TOOLS_OPENAI;

// ─── Tool execution ─────────────────────────────────────────────────────

function executeTool(toolName, args, ctx) {
    const ws = ctx.ws;
    switch (toolName) {
        case "read_file": {
            const filePath = path.join(ws, args.path);
            if (!existsSync(filePath)) return `Error: File not found: ${args.path}`;
            try {
                const content = readFileSync(filePath, "utf8");
                const lines = content.split("\n");
                const start = Math.max(0, (args.start_line || 1) - 1);
                const end = args.end_line ? Math.min(lines.length, args.end_line) : Math.min(lines.length, start + 200);
                const numbered = lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join("\n");
                return `File: ${args.path} (${lines.length} lines total, showing ${start + 1}-${end})\n${numbered}`;
            } catch (e) { return `Error reading file: ${e.message}`; }
        }
        case "list_dir": {
            const dirPath = path.join(ws, args.path || ".");
            if (!existsSync(dirPath)) return `Error: Directory not found: ${args.path}`;
            try {
                const entries = readdirSync(dirPath).slice(0, 80);
                return entries.map(e => {
                    try {
                        const s = statSync(path.join(dirPath, e));
                        return s.isDirectory() ? `${e}/` : `${e} (${s.size}b)`;
                    } catch { return e; }
                }).join("\n");
            } catch (e) { return `Error: ${e.message}`; }
        }
        case "grep_search": {
            try {
                const grepArgs = ["-rnI", "--max-count=5", "--include", args.include || "*.py"];
                if (args.path) grepArgs.push(args.pattern, path.join(ws, args.path));
                else grepArgs.push(args.pattern, ws);
                const stdout = execFileSync("grep", grepArgs, { maxBuffer: 1024 * 1024, timeout: 10_000, encoding: "utf8" });
                const result = stdout.replace(new RegExp(ws.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "/", "g"), "").split("\n").slice(0, 30).join("\n");
                return result || "No matches found.";
            } catch { return "No matches found."; }
        }
        case "edit_file": {
            const filePath = path.join(ws, args.path);
            if (!existsSync(filePath)) return `Error: File not found: ${args.path}`;
            try {
                let content = readFileSync(filePath, "utf8");
                if (!content.includes(args.old_text)) {
                    return `Error: old_text not found in ${args.path}. Make sure it matches exactly, including whitespace. Use read_file to see the exact content first.`;
                }
                content = content.replace(args.old_text, args.new_text);
                writeFileSync(filePath, content);
                return `Successfully edited ${args.path}. The old_text was replaced with new_text.`;
            } catch (e) { return `Error editing file: ${e.message}`; }
        }
        case "run_tests": {
            return "__RUN_TESTS__";
        }
        default:
            return `Unknown tool: ${toolName}`;
    }
}

// ─── Parse f2p label to runtests.py module argument ─────────────────────
function extractModuleFromLabel(label, tid) {
    // Format 1: "test_foo (module.tests.ClassName)" → "module.tests"
    // Format 2: "test_foo (mod.test.Class.test_foo)" → "mod.test"
    // Format 3: "Some docstring description (module.tests.Class)" → "module.tests"
    // Format 4: "module.tests.ClassName.test_method" → "module.tests"
    // Format 5: plain "test_foo" or docstring without parens → extract from test-patch.diff

    if (label.includes("(")) {
        const inner = label.split("(").pop().replace(")", "").trim();
        // inner is like "module.tests.ClassName" or "mod.test.Class.test_foo"
        const parts = inner.split(".");
        if (parts.length >= 2) {
            // Strip trailing ClassName and test_method parts, but keep module names
            // Strategy: from end, strip parts that are clearly class/method names
            let end = parts.length;
            // Strip last part if it's a test method name (test_xxx)
            if (end > 1 && parts[end - 1].startsWith("test_")) end--;
            // Strip parts that start with uppercase (class names)
            while (end > 1 && /^[A-Z]/.test(parts[end - 1])) end--;
            return parts.slice(0, end).join(".");
        }
    } else if (label.includes(".") && !label.includes(" ")) {
        // Dotted path: "module.tests.Class.test_method"
        const parts = label.split(".");
        let end = parts.length;
        if (end > 1 && parts[end - 1].startsWith("test_")) end--;
        while (end > 1 && /^[A-Z]/.test(parts[end - 1])) end--;
        return parts.slice(0, end).join(".");
    }

    // Fallback: extract module from test-patch.diff
    try {
        const tp = readFileSync(`${META}/${tid}/test-patch.diff`, "utf8");
        const matches = [...tp.matchAll(/diff --git a\/tests\/(.+?)\.py b\//g)];
        if (matches.length > 0) {
            return matches.map(m => m[1].replace(/\//g, "."));
        }
    } catch { }

    // Last resort: if label is a test function name
    if (label.startsWith("test_")) return label;

    return null; // Unusable label (docstring without parens, etc.)
}

// ─── Run tests (sync version) ───────────────────────────────────────────
function runTestsSync(ctx) {
    const { ws, tid, py, f2p, config } = ctx;
    const env = { ...process.env };
    delete env.PYTHONPATH;
    if (config.pp === "workspace") env.PYTHONPATH = ws;
    else if (config.pp === "workspace_lib") env.PYTHONPATH = `${ws}/lib`;
    env.MPLBACKEND = "agg";

    if (config.testMode === "runtests") {
        // Extract unique test modules from f2p labels
        const modules = new Set();
        for (const label of f2p) {
            const mod = extractModuleFromLabel(label, tid);
            if (mod) {
                if (Array.isArray(mod)) mod.forEach(m => modules.add(m));
                else modules.add(mod);
            }
        }

        if (modules.size === 0) {
            // Ultimate fallback: extract all test files from test-patch
            try {
                const tp = readFileSync(`${META}/${tid}/test-patch.diff`, "utf8");
                const matches = [...tp.matchAll(/diff --git a\/tests\/(.+?)\.py b\//g)];
                matches.forEach(m => modules.add(m[1].replace(/\//g, ".")));
            } catch { }
        }

        const moduleList = [...modules];
        if (moduleList.length === 0) {
            return { passed: false, summary: "No test modules found", details: "Could not parse f2p labels" };
        }

        const results = [];
        for (const mod of moduleList) {
            try {
                const r = execFileSync(py, [`${ws}/tests/runtests.py`, mod, "--verbosity=2"], {
                    cwd: ws, timeout: 180_000, maxBuffer: 10 * 1024 * 1024, env, encoding: "utf8",
                });
                results.push({ label: mod, passed: true, output: r.slice(-500) });
            } catch (e) {
                const out = (e.stdout || "") + "\n" + (e.stderr || "");
                results.push({ label: mod, passed: false, output: out.slice(-800) });
            }
        }
        const allPassed = results.every(r => r.passed);
        const summary = results.map(r => `${r.passed ? "✅" : "❌"} ${r.label}`).join("\n");
        return {
            passed: allPassed,
            summary,
            details: allPassed ? "All tests passed!" : results.filter(r => !r.passed).map(r => `FAILED: ${r.label}\n${r.output}`).join("\n\n"),
        };
    }

    // Non-runtests modes (pytest, direct, etc.)
    const results = [];
    for (const label of f2p) {
        try {
            let cmd, cmdArgs;
            if (config.testMode === "direct") {
                let grepResult;
                try { grepResult = execFileSync("grep", ["-rl", `def ${label}\\b`, ws], { timeout: 10_000, encoding: "utf8" }).trim(); }
                catch { grepResult = ""; }
                if (!grepResult) { results.push({ label, passed: false, output: "Test function not found" }); continue; }
                const tf = grepResult.split("\n")[0];
                const mp = tf.replace(ws + "/", "").replace(/\//g, ".").replace(".py", "");
                cmd = py; cmdArgs = ["-c", `import ${mp}; ${mp}.${label}(); print("OK")`];
            } else {
                cmd = py;
                cmdArgs = ["-m", "pytest", "-xvs", "--no-header", "-p", "no:cacheprovider"];
                if (config.testMode === "pytest_mpl") cmdArgs.splice(2, 0, "--override-ini=addopts=", "-W", "ignore::DeprecationWarning");
                else if (config.testMode === "pytest_astropy") cmdArgs.splice(2, 0, "--override-ini=addopts=");
                else if (config.testMode === "pytest_sklearn") cmdArgs.splice(2, 0, "--override-ini=addopts=", "--no-header");
                if (label.includes("::")) cmdArgs.push(label);
                else cmdArgs.push("-k", label);
            }
            const r = execFileSync(cmd, cmdArgs, {
                cwd: ws, timeout: 120_000, maxBuffer: 10 * 1024 * 1024, env, encoding: "utf8",
            });
            results.push({ label, passed: true, output: r.slice(-500) });
        } catch (e) {
            const out = (e.stdout || "") + "\n" + (e.stderr || "");
            results.push({ label, passed: false, output: out.slice(-800) });
        }
    }
    const allPassed = results.every(r => r.passed);
    const summary = results.map(r => `${r.passed ? "✅" : "❌"} ${r.label}`).join("\n");
    return {
        passed: allPassed,
        summary,
        details: allPassed ? "All tests passed!" : results.filter(r => !r.passed).map(r => `FAILED: ${r.label}\n${r.output}`).join("\n\n"),
    };
}

// ─── Agent Loop ─────────────────────────────────────────────────────────
// Sliding window: keep first message (system/task) + last MAX_HISTORY messages
const MAX_HISTORY = 12;

function trimMessages(messages) {
    if (messages.length <= MAX_HISTORY + 1) return messages;
    // Keep first message (system prompt) and last MAX_HISTORY messages
    const first = messages[0];
    const recent = messages.slice(-MAX_HISTORY);
    return [first, { role: "user", content: "[Earlier conversation truncated to save context. Continue working on the fix.]" }, ...recent];
}

async function runAgentLoop(model, apiKey, systemPrompt, ctx, maxTurns) {
    // For Anthropic: system goes as first user message. For OpenAI: system role.
    const messages = IS_ANTHROPIC ? [] : [{ role: "system", content: systemPrompt }];
    if (IS_ANTHROPIC) messages.push({ role: "user", content: systemPrompt });
    let totalTokens = { prompt: 0, completion: 0, total: 0 };
    let turns = 0;
    let testResult = null;
    const startTime = Date.now();

    for (let turn = 0; turn < maxTurns; turn++) {
        turns++;
        // Trim messages to keep context manageable
        const trimmed = trimMessages(messages);
        const response = await callLLMWithTools(model, apiKey, trimmed);
        if (!response.ok) {
            console.error(`    [ERROR] Turn ${turn + 1}: ${response.error?.slice(0, 120)}`);
            return { passed: false, turns, tokens: totalTokens, elapsed: Date.now() - startTime, error: response.error };
        }
        totalTokens.prompt += response.usage.prompt_tokens || 0;
        totalTokens.completion += response.usage.completion_tokens || 0;
        totalTokens.total += response.usage.total_tokens || 0;

        const assistantMsg = response.message;
        // Sanitize: strip extra fields from tool_calls that proxy may reject
        const cleanMsg = { role: assistantMsg.role || "assistant", content: assistantMsg.content || "" };
        if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
            cleanMsg.tool_calls = assistantMsg.tool_calls.map(tc => ({
                id: tc.id,
                type: "function",
                function: { name: tc.function.name, arguments: tc.function.arguments }
            }));
        }
        messages.push(cleanMsg);

        // Check if model wants to call tools
        if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
            for (const tc of assistantMsg.tool_calls) {
                const toolName = tc.function.name;
                let toolArgs;
                try { toolArgs = JSON.parse(tc.function.arguments); } catch { toolArgs = {}; }

                let toolResult;
                if (toolName === "run_tests") {
                    testResult = runTestsSync(ctx);
                    toolResult = `Test Results:\n${testResult.summary}\n\n${testResult.details}`;
                    if (testResult.passed) {
                        messages.push(IS_ANTHROPIC
                            ? { role: "user", content: `[Tool Result for ${toolName}]\n${toolResult}` }
                            : { role: "tool", tool_call_id: tc.id, content: toolResult });
                        return { passed: true, turns, tokens: totalTokens, elapsed: Date.now() - startTime };
                    }
                } else {
                    toolResult = executeTool(toolName, toolArgs, ctx);
                }
                // Truncate results aggressively to keep context small
                const resultContent = String(toolResult).slice(0, 4000);
                messages.push(IS_ANTHROPIC
                    ? { role: "user", content: `[Tool Result for ${toolName}]\n${resultContent}` }
                    : { role: "tool", tool_call_id: tc.id, content: resultContent });
            }
        } else {
            const content = assistantMsg.content || "";
            if (content.includes("I have completed") || content.includes("fix has been applied") || turn === maxTurns - 1) {
                testResult = runTestsSync(ctx);
                if (testResult.passed) {
                    return { passed: true, turns, tokens: totalTokens, elapsed: Date.now() - startTime };
                }
                messages.push({
                    role: "user",
                    content: `Tests failed after your changes:\n${testResult.summary}\n\n${testResult.details.slice(0, 2000)}\n\nPlease use the tools to read the relevant code and fix the issue.`
                });
            }
        }
    }

    if (!testResult) testResult = runTestsSync(ctx);
    return { passed: testResult?.passed || false, turns, tokens: totalTokens, elapsed: Date.now() - startTime };
}

// ─── LLM API call with tools ────────────────────────────────────────────
async function callLLMWithTools(model, apiKey, messages) {
    const baseUrl = process.env.ANTHROPIC_BASE_URL
        ? `${process.env.ANTHROPIC_BASE_URL}/v1`
        : (process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1");

    const MAX_RETRIES = 5;
    const RETRY_DELAYS = [30_000, 45_000, 60_000, 90_000, 120_000];
    const FETCH_TIMEOUT = 300_000; // 300 seconds

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const body = { model, messages, tools: TOOLS, max_tokens: 4096 };
            if (!IS_ANTHROPIC) body.tool_choice = "auto";

            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

            const response = await fetch(`${baseUrl}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${apiKey}`,
                    "HTTP-Referer": "https://github.com/StartripAI/Salacia",
                    "X-Title": "Salacia OEB Agent A/B",
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            clearTimeout(timer);

            if (response.status >= 500 && attempt < MAX_RETRIES) {
                const delay = RETRY_DELAYS[attempt] || 120_000;
                console.error(`    [RETRY] ${response.status} error, waiting ${delay / 1000}s (${attempt + 1}/${MAX_RETRIES})...`);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }

            if (response.status === 429 && attempt < MAX_RETRIES) {
                const delay = RETRY_DELAYS[attempt] || 120_000;
                console.error(`    [RETRY] Rate limited, waiting ${delay / 1000}s (${attempt + 1}/${MAX_RETRIES})...`);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }

            if (!response.ok) {
                const errText = await response.text();
                return { ok: false, error: `${response.status}: ${errText.slice(0, 300)}` };
            }
            const data = await response.json();
            return {
                ok: true,
                message: data.choices?.[0]?.message || { role: "assistant", content: "No response" },
                usage: data.usage || {},
            };
        } catch (err) {
            if (attempt < MAX_RETRIES) {
                const delay = RETRY_DELAYS[attempt] || 120_000;
                const msg = err.name === "AbortError" ? "Request timed out (300s)" : err.message.slice(0, 80);
                console.error(`    [RETRY] ${msg}, waiting ${delay / 1000}s (${attempt + 1}/${MAX_RETRIES})...`);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            return { ok: false, error: err.name === "AbortError" ? "Request timed out after 300s" : err.message };
        }
    }
    return { ok: false, error: "max retries exceeded" };
}

// ─── Build system prompts ───────────────────────────────────────────────
function buildBarePrompt(tid, problem) {
    return `You are a software engineer fixing a bug in an open-source project.

PROBLEM:
${problem}

INSTRUCTIONS:
1. Use the tools to explore the repository and understand the codebase.
2. Find the root cause of the bug.
3. Use edit_file to make the minimal fix.
4. Use run_tests to verify your fix passes the tests.
5. If tests fail, read the output, adjust your fix, and try again.

IMPORTANT:
- Always use read_file BEFORE edit_file to see exact content.
- The old_text in edit_file must match EXACTLY.
- Make minimal, focused changes only.
- Keep iterating until run_tests passes.`;
}

function buildScaffoldPrompt(tid, problem, ws) {
    // ── Real Fault Localization (no cheating!) ──
    let targetFiles = [];
    const flPath = FL_PATH;
    if (existsSync(flPath)) {
        const flData = JSON.parse(readFileSync(flPath, "utf8"));
        const entry = flData.results?.find(r => r.instanceId === tid);
        if (entry) targetFiles = entry.finalTop5 || entry.bm25Top5 || [];
    }

    // If FL has no results, fall back to bare prompt (don't give bad context)
    if (targetFiles.length === 0) {
        console.error(`    [FL] No FL results for ${tid}, using bare prompt as scaffold fallback`);
        return buildBarePrompt(tid, problem);
    }

    // Extract the test labels
    const f2p = JSON.parse(readFileSync(`${META}/${tid}/fail-to-pass.txt`, "utf8"));

    return `You are a software engineer fixing a bug in an open-source project.
Salacia has pre-analyzed the codebase and identified likely bug locations.

PROBLEM:
${problem}

SALACIA ANALYSIS:
Most likely bug locations (ranked by confidence):
${targetFiles.map((f, i) => `  ${i + 1}. ${f}`).join("\n")}

Failing tests to verify your fix:
${f2p.map(t => `  - ${t}`).join("\n")}

STRATEGY:
1. READ the #1 ranked file first using read_file — the bug is most likely there.
2. UNDERSTAND the root cause before editing. Look for the specific logic error.
3. FIX with the smallest possible change using edit_file.
4. VERIFY with run_tests. If tests fail, read the error carefully.
5. ITERATE: adjust your fix based on test output, don't start over.

IF THE BUG ISN'T IN THE SUGGESTED FILES:
- Use grep_search to find relevant code (search for error messages, class names, function names from the problem description).
- The FL suggestions are probabilistic — trust your judgment if the code doesn't match.

RULES:
- Make the smallest possible change. Do NOT refactor unrelated code.
- Always read_file BEFORE edit_file to see exact content.
- The old_text in edit_file must match the file content character-for-character.`;
}

// ─── Workspace helpers ──────────────────────────────────────────────────
async function resetWs(ws) {
    await execFileAsync("git", ["checkout", "."], { cwd: ws, timeout: 10_000 }).catch(() => { });
    await execFileAsync("git", ["clean", "-fd"], { cwd: ws, timeout: 10_000 }).catch(() => { });
}

async function applyTestPatch(ws, tid) {
    const tp = `${META}/${tid}/test-patch.diff`;
    await execFileAsync("git", ["apply", tp], { cwd: ws, timeout: 10_000 }).catch(() => {
        execFileAsync("git", ["apply", "--3way", tp], { cwd: ws, timeout: 10_000 }).catch(() => { });
    });
}

async function reinstall(tid, venv) {
    const pip = `${VENVS}/${venv}/bin/pip`;
    const ws = WS_PREFIX + tid;
    try { execFileSync(pip, ["install", "-e", "."], { cwd: ws, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 }); }
    catch { try { execFileSync(pip, ["install", "."], { cwd: ws, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 }); } catch { } }
}

// ─── Main ───────────────────────────────────────────────────────────────
async function main() {
    const args = process.argv.slice(2);
    let model = "google/gemini-3-flash-preview";
    let samplePath = "";
    let outputDir = "";
    let limit = Infinity;
    let maxTurns = 8;
    let resume = false;

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case "--model": model = args[++i]; break;
            case "--sample": samplePath = args[++i]; break;
            case "--output": outputDir = args[++i]; break;
            case "--limit": limit = Number(args[++i]); break;
            case "--max-turns": maxTurns = Number(args[++i]); break;
            case "--resume": resume = true; break;
        }
    }

    const apiKey = process.env.ANTHROPIC_AUTH_TOKEN || process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) { console.error("❌ API key required (set ANTHROPIC_AUTH_TOKEN, GEMINI_API_KEY, etc.)"); process.exit(1); }
    if (!samplePath) { console.error("--sample required"); process.exit(1); }
    if (!outputDir) outputDir = defaultOutputDir("ab-agent");
    await fs.mkdir(outputDir, { recursive: true });

    const sample = JSON.parse(readFileSync(samplePath, "utf8"));
    const ids = sample.map(s => typeof s === "string" ? s : s.instance_id).filter(Boolean).slice(0, limit);

    console.error(`[OEB Agent] Model: ${model} | Tasks: ${ids.length} | Max turns: ${maxTurns} | Output: ${outputDir}\n`);

    const results = [];

    for (let i = 0; i < ids.length; i++) {
        const tid = ids[i];
        const ws = WS_PREFIX + tid;
        if (!existsSync(ws)) {
            console.error(`[${i + 1}/${ids.length}] ${tid} — SKIP (no workspace)`);
            results.push({ instanceId: tid, gateResult: "error", error: "no workspace" });
            continue;
        }

        // Resume: skip tasks with existing results
        const taskDir = path.join(outputDir, `task-${i + 1}-${tid.replace(/[/\\]/g, "__")}`);
        if (resume && existsSync(path.join(taskDir, "result.json"))) {
            const prev = JSON.parse(readFileSync(path.join(taskDir, "result.json"), "utf8"));
            results.push(prev);
            console.error(`[${i + 1}/${ids.length}] ${tid} — RESUME (${prev.gateResult})`);
            continue;
        }

        const prefix = tid.split("__")[0];
        const config = REPO_CONFIG[prefix] || REPO_CONFIG.django;
        const venv = VENV_OVERRIDE[tid] || config.venv;
        const py = `${VENVS}/${venv}/bin/python3`;
        const f2p = JSON.parse(readFileSync(`${META}/${tid}/fail-to-pass.txt`, "utf8"));
        const problem = existsSync(`${META}/${tid}/problem.txt`)
            ? readFileSync(`${META}/${tid}/problem.txt`, "utf8")
            : `Fix the issue in ${tid}`;

        const ctx = { ws, tid, py, f2p, config };

        console.error(`\n[${i + 1}/${ids.length}] ─── ${tid} ───`);

        await fs.mkdir(taskDir, { recursive: true });

        // ── BARE RUN ──
        console.error("  [BARE] Starting agent loop...");
        await resetWs(ws);
        await applyTestPatch(ws, tid);
        if (EDITABLE_TASK[tid]) reinstall(tid, EDITABLE_TASK[tid]);
        else if (EDITABLE_REPOS[prefix]) reinstall(tid, EDITABLE_REPOS[prefix]);

        const barePrompt = buildBarePrompt(tid, problem);
        const bareResult = await runAgentLoop(model, apiKey, barePrompt, ctx, maxTurns);
        console.error(`  [BARE] ${bareResult.passed ? "✅ PASS" : "❌ FAIL"} (${bareResult.turns} turns, ${bareResult.tokens.total} tokens)`);

        // ── SCAFFOLD RUN ──
        console.error("  [SCAFFOLD] Starting agent loop...");
        await resetWs(ws);
        await applyTestPatch(ws, tid);
        if (EDITABLE_TASK[tid]) reinstall(tid, EDITABLE_TASK[tid]);
        else if (EDITABLE_REPOS[prefix]) reinstall(tid, EDITABLE_REPOS[prefix]);

        const scaffoldPrompt = buildScaffoldPrompt(tid, problem, ws);
        const scaffoldResult = await runAgentLoop(model, apiKey, scaffoldPrompt, ctx, maxTurns);
        console.error(`  [SCAFFOLD] ${scaffoldResult.passed ? "✅ PASS" : "❌ FAIL"} (${scaffoldResult.turns} turns, ${scaffoldResult.tokens.total} tokens)`);

        // ── Gate Decision ──
        let gateResult;
        if (scaffoldResult.passed && !bareResult.passed) gateResult = "scaffold-win";
        else if (scaffoldResult.passed && bareResult.passed) gateResult = "both-pass";
        else if (!scaffoldResult.passed && bareResult.passed) gateResult = "fallback-bare";
        else gateResult = "both-fail";

        const icon = gateResult === "scaffold-win" ? "🏆" :
            gateResult === "both-pass" ? "✅" :
                gateResult === "fallback-bare" ? "⚠️" : "❌";
        const bSec = Math.round((bareResult.elapsed || 0) / 1000);
        const sSec = Math.round((scaffoldResult.elapsed || 0) / 1000);
        console.error(`  ${icon} ${gateResult} | B:${bareResult.turns}t/${bSec}s/${bareResult.tokens?.total || 0}tok S:${scaffoldResult.turns}t/${sSec}s/${scaffoldResult.tokens?.total || 0}tok`);

        const result = {
            instanceId: tid, gateResult,
            bare: { passed: bareResult.passed, turns: bareResult.turns, tokens: bareResult.tokens, elapsed: bareResult.elapsed },
            scaffold: { passed: scaffoldResult.passed, turns: scaffoldResult.turns, tokens: scaffoldResult.tokens, elapsed: scaffoldResult.elapsed },
        };
        results.push(result);
        await fs.writeFile(path.join(taskDir, "result.json"), JSON.stringify(result, null, 2), "utf8");

        await resetWs(ws);
    }

    // ── Aggregate ──
    const n = results.length;
    const barePass = results.filter(r => r.bare?.passed).length;
    const scaffoldPass = results.filter(r => r.scaffold?.passed).length;
    const scaffoldWins = results.filter(r => r.gateResult === "scaffold-win").length;
    const bothPass = results.filter(r => r.gateResult === "both-pass").length;
    const fallbacks = results.filter(r => r.gateResult === "fallback-bare").length;
    const bothFails = results.filter(r => r.gateResult === "both-fail").length;

    const totalBareTokens = results.reduce((s, r) => s + (r.bare?.tokens?.total || 0), 0);
    const totalScaffoldTokens = results.reduce((s, r) => s + (r.scaffold?.tokens?.total || 0), 0);
    const avgBareTurns = n > 0 ? (results.reduce((s, r) => s + (r.bare?.turns || 0), 0) / n).toFixed(1) : 0;
    const avgScaffoldTurns = n > 0 ? (results.reduce((s, r) => s + (r.scaffold?.turns || 0), 0) / n).toFixed(1) : 0;

    const accBare = n > 0 ? barePass / n : 0;
    const accScaffold = n > 0 ? scaffoldPass / n : 0;
    const uplift = accBare > 0 ? (accScaffold / accBare).toFixed(2) : (accScaffold > 0 ? "∞" : "1.00");

    const report = {
        model, tasks: n, maxTurns,
        mode: "multi-turn agent loop",
        accuracy: { bare: `${Math.round(accBare * 100)}%`, scaffold: `${Math.round(accScaffold * 100)}%` },
        tokens: { totalBare: totalBareTokens, totalScaffold: totalScaffoldTokens },
        avgTurns: { bare: avgBareTurns, scaffold: avgScaffoldTurns },
        metrics: { accuracy_uplift: uplift },
        breakdown: { scaffoldWins, bothPass, fallbacks, bothFails },
        results,
        generatedAt: new Date().toISOString(),
    };

    await fs.writeFile(path.join(outputDir, "oeb-agent-report.json"), JSON.stringify(report, null, 2), "utf8");

    // Markdown
    const md = [
        `# Salacia OEB Agent A/B — ${model}`,
        `> Multi-turn agent loop | Max ${maxTurns} turns | ${new Date().toISOString()}`,
        "",
        "## Results",
        "| | Bare | Scaffold |",
        "|--|------|----------|",
        `| **Pass Rate** | ${Math.round(accBare * 100)}% (${barePass}/${n}) | ${Math.round(accScaffold * 100)}% (${scaffoldPass}/${n}) |`,
        `| **Avg Turns** | ${avgBareTurns} | ${avgScaffoldTurns} |`,
        `| **Tokens** | ${totalBareTokens} | ${totalScaffoldTokens} |`,
        "",
        `**Accuracy Uplift: ${uplift}×**`,
        "",
        "## Breakdown",
        "| 🏆 Scaffold Win | ✅ Both Pass | ⚠️ Fallback | ❌ Both Fail |",
        "|-----------------|-------------|------------|------------|",
        `| ${scaffoldWins} | ${bothPass} | ${fallbacks} | ${bothFails} |`,
        "",
        "## Per-Task",
        "| Task | Bare | Scaffold | Gate |",
        "|------|------|----------|------|",
        ...results.map(r => {
            const icon = r.gateResult === "scaffold-win" ? "🏆" : r.gateResult === "both-pass" ? "✅" : r.gateResult === "fallback-bare" ? "⚠️" : "❌";
            return `| ${r.instanceId} | ${r.bare?.passed ? "✅" : "❌"} (${r.bare?.turns}t) | ${r.scaffold?.passed ? "✅" : "❌"} (${r.scaffold?.turns}t) | ${icon} |`;
        }),
    ].join("\n");
    await fs.writeFile(path.join(outputDir, "oeb-agent-report.md"), md, "utf8");

    console.error(`\n${"═".repeat(60)}`);
    console.error(`OEB AGENT A/B (${model})`);
    console.error(`${"═".repeat(60)}`);
    console.error(`Bare:     ${barePass}/${n} (${Math.round(accBare * 100)}%) | avg ${avgBareTurns} turns`);
    console.error(`Scaffold: ${scaffoldPass}/${n} (${Math.round(accScaffold * 100)}%) | avg ${avgScaffoldTurns} turns`);
    console.error(`Uplift:   ${uplift}×`);
    console.error(`Gate:     ${accScaffold >= accBare ? "✅ PASS" : "❌ FAIL"}`);
}

main().catch(err => { console.error("[Salacia] oeb-agent-ab crashed:", err); process.exit(2); });
