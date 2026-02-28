#!/usr/bin/env node
/**
 * prepare-workspaces.mjs — Batch prepare SWE-bench workspaces
 * 
 * Downloads SWE-bench Verified dataset, picks tasks not yet prepared,
 * clones repos, checks out base commits, applies test patches.
 *
 * Usage:
 *   node scripts/benchmark/prepare-workspaces.mjs --count 50 --skip-existing
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { META, WS_PREFIX, PYTHON_BIN } from "./bench-config.mjs";

async function main() {
    const args = process.argv.slice(2);
    let count = 50;
    let skipExisting = true;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--count") count = Number(args[++i]);
        if (args[i] === "--no-skip") skipExisting = false;
    }

    // Get existing tasks
    const existing = new Set(existsSync(META) ? readdirSync(META) : []);
    console.error(`[PREP] Existing tasks: ${existing.size}`);

    // Load SWE-bench Verified dataset via Python
    console.error("[PREP] Loading SWE-bench Verified dataset...");
    const datasetJson = execSync(
        `${PYTHON_BIN} -c "
import json
from datasets import load_dataset
ds = load_dataset('princeton-nlp/SWE-bench_Verified', split='test')
items = []
for x in ds:
    items.append({
        'instance_id': x['instance_id'],
        'repo': x['repo'],
        'base_commit': x['base_commit'],
        'patch': x['patch'],
        'test_patch': x['test_patch'],
        'problem_statement': x['problem_statement'],
        'FAIL_TO_PASS': x['FAIL_TO_PASS'],
    })
print(json.dumps(items))
"`, { maxBuffer: 100 * 1024 * 1024, timeout: 120_000 }
    ).toString().trim();

    const allTasks = JSON.parse(datasetJson);
    console.error(`[PREP] Total SWE-bench Verified tasks: ${allTasks.length}`);

    // Filter to new tasks
    let newTasks = skipExisting
        ? allTasks.filter(t => !existing.has(t.instance_id))
        : allTasks;

    // Shuffle deterministically and pick
    newTasks.sort((a, b) => {
        const ha = hashStr(a.instance_id);
        const hb = hashStr(b.instance_id);
        return ha - hb;
    });
    newTasks = newTasks.slice(0, count);
    console.error(`[PREP] Preparing ${newTasks.length} new tasks...`);

    let success = 0, fail = 0;
    for (let i = 0; i < newTasks.length; i++) {
        const t = newTasks[i];
        const tid = t.instance_id;
        const ws = WS_PREFIX + tid;
        const metaDir = `${META}/${tid}`;
        console.error(`  [${i + 1}/${newTasks.length}] ${tid}`);

        try {
            // Create meta
            mkdirSync(metaDir, { recursive: true });
            writeFileSync(`${metaDir}/problem.txt`, t.problem_statement);
            writeFileSync(`${metaDir}/gold-patch.diff`, t.patch);
            writeFileSync(`${metaDir}/test-patch.diff`, t.test_patch);
            writeFileSync(`${metaDir}/fail-to-pass.txt`, t.FAIL_TO_PASS);

            if (existsSync(ws)) {
                console.error(`    [SKIP] Workspace exists`);
                success++;
                continue;
            }

            // Clone repo
            mkdirSync(ws, { recursive: true });
            execSync(`git clone --depth=1 https://github.com/${t.repo}.git "${ws}"`, {
                timeout: 180_000,
                maxBuffer: 50 * 1024 * 1024,
                stdio: 'pipe',
            });

            // Fetch and checkout base commit
            execSync(`git fetch --depth=100 origin ${t.base_commit}`, {
                cwd: ws, timeout: 120_000, maxBuffer: 50 * 1024 * 1024, stdio: 'pipe',
            });
            execSync(`git checkout ${t.base_commit}`, {
                cwd: ws, timeout: 30_000, stdio: 'pipe',
            });

            // Apply test patch
            try {
                execSync(`git apply --allow-empty "${metaDir}/test-patch.diff"`, {
                    cwd: ws, timeout: 10_000, stdio: 'pipe',
                });
            } catch {
                // Try 3way merge
                try {
                    execSync(`git apply --3way "${metaDir}/test-patch.diff"`, {
                        cwd: ws, timeout: 10_000, stdio: 'pipe',
                    });
                } catch { /* ignore, tests may still work */ }
            }

            console.error(`    ✅ Ready`);
            success++;
        } catch (err) {
            console.error(`    ❌ ${err.message.slice(0, 100)}`);
            fail++;
            // Clean up failed workspace
            try { execSync(`rm -rf "${ws}"`); } catch { }
        }
    }

    console.error(`\n[PREP] Done: ${success} success, ${fail} failed`);
}

function hashStr(s) {
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
        hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
    }
    return hash;
}

main().catch(err => { console.error("[Salacia] prepare-workspaces crashed:", err); process.exit(2); });
