#!/usr/bin/env node
/**
 * prepare-full-campaign.mjs
 * 
 * Prepares ALL Django SWE-bench Verified tasks for a full A/B campaign.
 * Steps:
 *   1. Load dataset, filter Django tasks
 *   2. Categorize each task by case type
 *   3. Prepare metadata (problem, patches, f2p)
 *   4. Clone workspaces
 *   5. Run FL on all tasks
 *   6. Save sample + category map
 * 
 * Usage:
 *   node scripts/benchmark/prepare-full-campaign.mjs [--limit N] [--skip-clone] [--skip-fl]
 */
import { execSync, execFileSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { BASE, META, WS_PREFIX, VENVS, PYTHON_BIN } from "./bench-config.mjs";

// ─── Parse args ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const limit = args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1]) : Infinity;
const skipClone = args.includes("--skip-clone");
const skipFL = args.includes("--skip-fl");

// ─── Categorize a task into case types ──────────────────────────────────
function categorizeTask(task) {
    const patch = task.patch || "";
    const problem = task.problem_statement || "";
    const f2p = JSON.parse(task.FAIL_TO_PASS || "[]");

    const filesChanged = (patch.match(/diff --git/g) || []).length;
    const linesChanged = (patch.match(/^[+-][^+-]/gm) || []).length;

    const categories = [];

    // Case 1: Single-file bug fix (most common)
    if (filesChanged === 1) categories.push("case1_single_bug");

    // Case 5/9: Multi-file changes
    if (filesChanged >= 2) categories.push("case5_multi_file");
    if (filesChanged >= 3) categories.push("case9_cross_file");

    // Subcategories by Django area
    const patchFiles = [...patch.matchAll(/diff --git a\/(.+?) b\//g)].map(m => m[1]);
    const areas = new Set();
    for (const f of patchFiles) {
        if (f.includes("db/models") || f.includes("db/backends")) areas.add("orm");
        if (f.includes("migrations")) areas.add("migrations");
        if (f.includes("forms")) areas.add("forms");
        if (f.includes("admin")) areas.add("admin");
        if (f.includes("template")) areas.add("template");
        if (f.includes("http") || f.includes("views")) areas.add("http");
        if (f.includes("utils")) areas.add("utils");
        if (f.includes("core/management")) areas.add("management");
    }
    categories.push(...[...areas].map(a => `area_${a}`));

    // Complexity tier
    if (linesChanged <= 5) categories.push("complexity_trivial");
    else if (linesChanged <= 20) categories.push("complexity_moderate");
    else categories.push("complexity_complex");

    // Test count
    if (f2p.length === 1) categories.push("tests_single");
    else if (f2p.length <= 5) categories.push("tests_few");
    else categories.push("tests_many");

    return {
        filesChanged,
        linesChanged,
        f2pCount: f2p.length,
        areas: [...areas],
        categories,
    };
}

async function main() {
    console.log("═".repeat(60));
    console.log("SALACIA FULL CAMPAIGN PREPARATION");
    console.log("═".repeat(60));

    // ── Step 1: Load dataset ────────────────────────────────────────────
    console.log("\n[1/5] Loading SWE-bench Verified dataset...");
    const dsOutput = execSync(
        `${PYTHON_BIN} -c "
import json
from datasets import load_dataset
ds = load_dataset('princeton-nlp/SWE-bench_Verified', split='test')
tasks = [dict(x) for x in ds if x['instance_id'].startswith('django__')]
# Convert to JSON-serializable
for t in tasks:
    for k in list(t.keys()):
        if isinstance(t[k], bytes): t[k] = t[k].decode()
json.dump(tasks, open('${BASE}/django-all.json', 'w'))
print(len(tasks))
"`,
        { encoding: "utf8", timeout: 60_000, maxBuffer: 50 * 1024 * 1024 }
    ).trim();

    const allTasks = JSON.parse(readFileSync(`${BASE}/django-all.json`, "utf8"));
    console.log(`  Found ${allTasks.length} Django tasks`);

    // ── Step 2: Categorize ──────────────────────────────────────────────
    console.log("\n[2/5] Categorizing tasks...");
    const tasks = allTasks.slice(0, limit);
    const categoryMap = {};
    const sample = [];

    for (const t of tasks) {
        const cat = categorizeTask(t);
        categoryMap[t.instance_id] = cat;
        sample.push({ instance_id: t.instance_id });
    }

    // Print category distribution
    const catCounts = {};
    for (const [, cat] of Object.entries(categoryMap)) {
        for (const c of cat.categories) {
            catCounts[c] = (catCounts[c] || 0) + 1;
        }
    }
    console.log("  Category distribution:");
    for (const [k, v] of Object.entries(catCounts).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${k.padEnd(25)} ${v}`);
    }

    // Save
    writeFileSync(`${BASE}/campaign-sample.json`, JSON.stringify(sample, null, 2));
    writeFileSync(`${BASE}/campaign-categories.json`, JSON.stringify(categoryMap, null, 2));
    console.log(`  Saved ${tasks.length} tasks to campaign-sample.json`);

    // ── Step 3: Prepare metadata ────────────────────────────────────────
    console.log("\n[3/5] Preparing metadata...");
    let metaOk = 0;
    for (const t of tasks) {
        const dir = `${META}/${t.instance_id}`;
        mkdirSync(dir, { recursive: true });
        writeFileSync(`${dir}/problem.txt`, t.problem_statement);
        writeFileSync(`${dir}/gold-patch.diff`, t.patch);
        writeFileSync(`${dir}/test-patch.diff`, t.test_patch);
        writeFileSync(`${dir}/fail-to-pass.txt`, t.FAIL_TO_PASS);
        metaOk++;
    }
    console.log(`  Prepared metadata for ${metaOk} tasks`);

    // ── Step 4: Clone workspaces ────────────────────────────────────────
    if (skipClone) {
        console.log("\n[4/5] Skipping workspace cloning (--skip-clone)");
    } else {
        console.log("\n[4/5] Cloning workspaces...");

        // Ensure Django venv
        mkdirSync(`${VENVS}/django/bin`, { recursive: true });
        if (!existsSync(`${VENVS}/django/bin/python3`)) {
            try { execSync(`ln -sf ${PYTHON_BIN} ${VENVS}/django/bin/python3`); }
            catch { }
        }

        let cloned = 0, reused = 0, failed = 0;
        for (let i = 0; i < tasks.length; i++) {
            const t = tasks[i];
            const ws = WS_PREFIX + t.instance_id;
            const metaDir = `${META}/${t.instance_id}`;

            process.stdout.write(`  [${i + 1}/${tasks.length}] ${t.instance_id}...`);

            try {
                if (existsSync(`${ws}/.git/HEAD`)) {
                    // Reset existing
                    execSync(`git checkout . && git clean -fd`, { cwd: ws, timeout: 10_000, stdio: "ignore" });
                    execSync(`git checkout ${t.base_commit}`, { cwd: ws, timeout: 30_000, stdio: "ignore" });
                    try { execSync(`git apply ${metaDir}/test-patch.diff`, { cwd: ws, timeout: 10_000, stdio: "ignore" }); }
                    catch { try { execSync(`git apply --3way ${metaDir}/test-patch.diff`, { cwd: ws, timeout: 10_000, stdio: "ignore" }); } catch { } }
                    console.log(" [reuse]");
                    reused++;
                } else {
                    if (existsSync(ws)) rmSync(ws, { recursive: true, force: true });
                    mkdirSync(ws, { recursive: true });
                    execSync(`git clone --depth=1 https://github.com/${t.repo}.git ${ws}`, { timeout: 180_000, stdio: "ignore" });
                    execSync(`git fetch --depth=100 origin ${t.base_commit}`, { cwd: ws, timeout: 120_000, stdio: "ignore" });
                    execSync(`git checkout ${t.base_commit}`, { cwd: ws, timeout: 30_000, stdio: "ignore" });
                    try { execSync(`git apply ${metaDir}/test-patch.diff`, { cwd: ws, timeout: 10_000, stdio: "ignore" }); }
                    catch { try { execSync(`git apply --3way ${metaDir}/test-patch.diff`, { cwd: ws, timeout: 10_000, stdio: "ignore" }); } catch { } }
                    console.log(" ✅");
                    cloned++;
                }
            } catch (e) {
                console.log(` ❌ ${e.message.slice(0, 60)}`);
                if (existsSync(ws)) rmSync(ws, { recursive: true, force: true });
                failed++;
            }
        }
        console.log(`  Done: ${cloned} cloned, ${reused} reused, ${failed} failed`);
    }

    // ── Step 5: Run FL ──────────────────────────────────────────────────
    if (skipFL) {
        console.log("\n[5/5] Skipping FL (--skip-fl)");
    } else {
        console.log("\n[5/5] Running Fault Localization...");
        console.log("  Run manually:");
        console.log(`  ANTHROPIC_BASE_URL=... ANTHROPIC_AUTH_TOKEN=... \\`);
        console.log(`    node scripts/benchmark/fault-localizer.mjs \\`);
        console.log(`      --validate --llm --model claude-sonnet-4-6 \\`);
        console.log(`      --output ${BASE}/fl-results-merged.json`);
    }

    console.log("\n" + "═".repeat(60));
    console.log("PREPARATION COMPLETE");
    console.log("═".repeat(60));
    console.log(`\nTo run the campaign:`);
    console.log(`  ANTHROPIC_BASE_URL=... ANTHROPIC_AUTH_TOKEN=... \\`);
    console.log(`    node scripts/benchmark/oeb-agent-ab.mjs \\`);
    console.log(`      --model claude-sonnet-4-6 \\`);
    console.log(`      --sample ${BASE}/campaign-sample.json \\`);
    console.log(`      --max-turns 10 \\`);
    console.log(`      --output ${BASE}/ab-full-campaign`);
    console.log(`\nTo analyze results:`);
    console.log(`  node scripts/benchmark/analyze-campaign.mjs \\`);
    console.log(`    --results ${BASE}/ab-full-campaign \\`);
    console.log(`    --categories ${BASE}/campaign-categories.json`);
}

main().catch(console.error);
