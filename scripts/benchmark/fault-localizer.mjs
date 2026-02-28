#!/usr/bin/env node
/**
 * fault-localizer.mjs — Salacia Fault Localizer
 *
 * Predicts which files contain the bug WITHOUT looking at gold patches.
 * Uses a 2-stage pipeline:
 *   Stage 1: BM25 text search to get Top-20 candidates
 *   Stage 2: LLM (Flash) to re-rank → output Top-5
 *
 * Usage:
 *   node scripts/benchmark/fault-localizer.mjs \
 *     --meta /tmp/salacia-oeb/meta \
 *     --output /tmp/salacia-oeb/fl-results.json \
 *     [--validate]   # compare against gold patches
 *     [--llm]        # enable LLM re-ranking (costs ~$0.01/task)
 *     [--limit 10]   # limit tasks
 */
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { META, WS_PREFIX, defaultFLOutput } from "./bench-config.mjs";

// ─── BM25 Simple Implementation ─────────────────────────────────────────
// Simplified BM25 scoring for file ranking

function tokenize(text) {
    return text.toLowerCase()
        .replace(/[^a-z0-9_]/g, " ")
        .split(/\s+/)
        .filter(t => t.length > 2 && !STOP_WORDS.has(t));
}

const STOP_WORDS = new Set([
    "the", "and", "for", "that", "this", "with", "are", "was", "has", "have",
    "not", "but", "from", "can", "should", "would", "could", "will", "been",
    "than", "them", "then", "into", "also", "when", "which", "there", "their",
    "more", "some", "other", "each", "about", "between", "through", "just",
    "def", "class", "self", "return", "import", "from", "none", "true", "false",
    "test", "tests", "file", "line", "error", "issue", "bug", "fix", "patch",
]);

function bm25Score(queryTokens, docTokens, avgDl, k1 = 1.5, b = 0.75) {
    const dl = docTokens.length;
    const tf = {};
    for (const t of docTokens) tf[t] = (tf[t] || 0) + 1;

    let score = 0;
    for (const q of queryTokens) {
        const f = tf[q] || 0;
        if (f === 0) continue;
        const idf = 1; // simplified: all query terms are equally important
        const numerator = f * (k1 + 1);
        const denominator = f + k1 * (1 - b + b * dl / avgDl);
        score += idf * numerator / denominator;
    }
    return score;
}

// ─── File Collection ────────────────────────────────────────────────────
function collectPyFiles(wsDir, maxFiles = 2000) {
    const files = [];
    const queue = [wsDir];
    const skip = new Set([".git", "node_modules", "__pycache__", ".tox", ".eggs",
        "build", "dist", ".egg-info", "venv", "env", "migrations"]);

    while (queue.length > 0 && files.length < maxFiles) {
        const dir = queue.shift();
        let entries;
        try { entries = readdirSync(dir); } catch { continue; }
        for (const e of entries) {
            if (skip.has(e) || e.startsWith(".")) continue;
            const fp = path.join(dir, e);
            let st;
            try { st = statSync(fp); } catch { continue; }
            if (st.isDirectory()) {
                queue.push(fp);
            } else if (e.endsWith(".py") && !e.startsWith("test_") &&
                !fp.includes("/tests/") && !fp.includes("/test/") &&
                !fp.includes("/testing/") && st.size < 500_000) {
                files.push(fp);
            }
        }
    }
    return files;
}

// ─── Stage 1: BM25 Ranking ─────────────────────────────────────────────
function bm25Rank(problemText, wsDir, topK = 20) {
    const queryTokens = tokenize(problemText);
    const files = collectPyFiles(wsDir);

    // Extract important identifiers from problem text
    // Look for things that look like Python names: module.class.method, ClassName, function_name
    const identifiers = new Set();
    const idPatterns = [
        /\b([A-Z][a-zA-Z0-9]+)\b/g,           // CamelCase class names
        /\b([a-z_][a-z0-9_]+)\b/g,             // snake_case names
        /\b([a-z_]+\.[a-z_]+(?:\.[a-z_]+)*)\b/g, // dotted paths
    ];
    for (const pat of idPatterns) {
        for (const m of problemText.matchAll(pat)) {
            if (m[1].length > 3) identifiers.add(m[1].toLowerCase());
        }
    }

    // Score each file
    const scored = [];
    const allDocs = [];

    for (const fp of files) {
        let content;
        try {
            content = readFileSync(fp, "utf8");
        } catch { continue; }

        const relPath = fp.replace(wsDir + "/", "");
        const docTokens = tokenize(content);
        allDocs.push({ relPath, docTokens, content });
    }

    const avgDl = allDocs.reduce((s, d) => s + d.docTokens.length, 0) / (allDocs.length || 1);

    for (const doc of allDocs) {
        // BM25 score
        let score = bm25Score(queryTokens, doc.docTokens, avgDl);

        // Bonus for path matching identifiers from problem text
        const pathLower = doc.relPath.toLowerCase();
        for (const id of identifiers) {
            if (pathLower.includes(id)) score += 5;
            // file name matches
            const basename = path.basename(doc.relPath, ".py").toLowerCase();
            if (id.includes(basename) || basename.includes(id)) score += 3;
        }

        // Bonus for files mentioned by path-like patterns in problem text
        const pathParts = doc.relPath.split("/");
        for (const part of pathParts) {
            const partName = part.replace(".py", "").toLowerCase();
            if (partName.length > 3 && problemText.toLowerCase().includes(partName)) {
                score += 2;
            }
        }

        scored.push({ path: doc.relPath, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
}

// ─── Stage 2: LLM Re-ranking ───────────────────────────────────────────
async function llmRerank(problemText, candidates, apiKey, model = "google/gemini-3-flash-preview") {
    const baseUrl = process.env.ANTHROPIC_BASE_URL
        ? `${process.env.ANTHROPIC_BASE_URL}/v1`
        : (process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1");

    const isAnthropic = !!process.env.ANTHROPIC_BASE_URL;

    const prompt = `You are analyzing a bug report to predict which source files need to be modified.

BUG REPORT:
${problemText.slice(0, 3000)}

CANDIDATE FILES (ranked by text relevance):
${candidates.map((c, i) => `${i + 1}. ${c.path} (score: ${c.score.toFixed(1)})`).join("\n")}

Based on the bug report, which files are MOST LIKELY to contain the bug and need modification?
Return ONLY a JSON array of the top 5 file paths, most likely first.
Example: ["django/contrib/auth/validators.py", "django/forms/fields.py"]

Respond with ONLY the JSON array, no explanation.`;

    const messages = isAnthropic
        ? [{ role: "user", content: prompt }]
        : [{ role: "system", content: "You predict bug locations. Return only JSON." }, { role: "user", content: prompt }];

    const body = { model, messages, max_tokens: 500, temperature: 0 };

    try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) return null;
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content || "";
        // Extract JSON array from response
        const match = text.match(/\[[\s\S]*?\]/);
        if (match) {
            const arr = JSON.parse(match[0]);
            return arr.filter(p => typeof p === "string").slice(0, 5);
        }
    } catch { }
    return null;
}

// ─── Gold Patch Extraction ──────────────────────────────────────────────
function extractGoldFiles(tid) {
    const patchPath = `${META}/${tid}/gold-patch.diff`;
    if (!existsSync(patchPath)) return [];
    const patch = readFileSync(patchPath, "utf8");
    return [...new Set((patch.match(/diff --git a\/(.+?) b\//g) || [])
        .map(m => m.replace("diff --git a/", "").replace(/ b\/.*/, "")))];
}

// ─── Main ───────────────────────────────────────────────────────────────
async function main() {
    const args = process.argv.slice(2);
    let outputPath = defaultFLOutput();
    let validate = false;
    let useLLM = false;
    let limit = Infinity;
    let llmModel = "google/gemini-3-flash-preview";

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case "--output": outputPath = args[++i]; break;
            case "--validate": validate = true; break;
            case "--llm": useLLM = true; break;
            case "--limit": limit = Number(args[++i]); break;
            case "--model": llmModel = args[++i]; break;
        }
    }

    const apiKey = process.env.ANTHROPIC_AUTH_TOKEN || process.env.GEMINI_API_KEY ||
        process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;

    if (useLLM && !apiKey) {
        console.error("❌ API key required for --llm mode");
        process.exit(1);
    }

    const tasks = readdirSync(META).slice(0, limit);
    console.error(`[FL] Tasks: ${tasks.length} | LLM: ${useLLM ? llmModel : "off"} | Validate: ${validate}`);

    const results = [];
    let bm25Hits = { top1: 0, top3: 0, top5: 0 };
    let llmHits = { top1: 0, top3: 0, top5: 0 };
    let totalGold = 0;

    for (let i = 0; i < tasks.length; i++) {
        const tid = tasks[i];
        const ws = WS_PREFIX + tid;
        const problemPath = `${META}/${tid}/problem.txt`;

        if (!existsSync(ws) || !existsSync(problemPath)) {
            console.error(`  [${i + 1}/${tasks.length}] ${tid} — SKIP (no workspace)`);
            continue;
        }

        const problem = readFileSync(problemPath, "utf8");
        const goldFiles = extractGoldFiles(tid);

        // Stage 1: BM25
        console.error(`  [${i + 1}/${tasks.length}] ${tid}`);
        const bm25Results = bm25Rank(problem, ws);
        const bm25Top5 = bm25Results.slice(0, 5).map(r => r.path);

        // Stage 2: LLM (optional)
        let llmTop5 = null;
        if (useLLM && apiKey) {
            llmTop5 = await llmRerank(problem, bm25Results, apiKey, llmModel);
            if (!llmTop5) {
                console.error(`    [LLM] Failed, falling back to BM25`);
                llmTop5 = bm25Top5;
            }
        }

        const finalTop5 = llmTop5 || bm25Top5;

        // Validation
        if (validate && goldFiles.length > 0) {
            totalGold++;
            const checkHit = (predicted, gold) => {
                return gold.some(g => predicted.some(p =>
                    p === g || p.endsWith("/" + g.split("/").pop()) || g.endsWith("/" + p.split("/").pop())
                ));
            };

            const bm25Hit1 = checkHit(bm25Top5.slice(0, 1), goldFiles);
            const bm25Hit3 = checkHit(bm25Top5.slice(0, 3), goldFiles);
            const bm25Hit5 = checkHit(bm25Top5, goldFiles);
            if (bm25Hit1) bm25Hits.top1++;
            if (bm25Hit3) bm25Hits.top3++;
            if (bm25Hit5) bm25Hits.top5++;

            if (llmTop5) {
                const llmHit1 = checkHit(llmTop5.slice(0, 1), goldFiles);
                const llmHit3 = checkHit(llmTop5.slice(0, 3), goldFiles);
                const llmHit5 = checkHit(llmTop5, goldFiles);
                if (llmHit1) llmHits.top1++;
                if (llmHit3) llmHits.top3++;
                if (llmHit5) llmHits.top5++;
            }

            const icon = checkHit(finalTop5, goldFiles) ? "✅" : "❌";
            console.error(`    ${icon} Gold: ${goldFiles.join(", ")}`);
            console.error(`       BM25: ${bm25Top5.slice(0, 3).join(", ")}`);
            if (llmTop5) console.error(`       LLM:  ${llmTop5.slice(0, 3).join(", ")}`);
        }

        results.push({
            instanceId: tid,
            bm25Top5,
            llmTop5: llmTop5 || null,
            finalTop5,
            goldFiles,
        });
    }

    // Summary
    if (validate && totalGold > 0) {
        console.error(`\n${"═".repeat(60)}`);
        console.error(`FAULT LOCALIZATION ACCURACY (${totalGold} tasks)`);
        console.error(`${"═".repeat(60)}`);
        console.error(`BM25:  Top-1=${(bm25Hits.top1 / totalGold * 100).toFixed(0)}%  Top-3=${(bm25Hits.top3 / totalGold * 100).toFixed(0)}%  Top-5=${(bm25Hits.top5 / totalGold * 100).toFixed(0)}%`);
        if (useLLM) {
            console.error(`LLM:   Top-1=${(llmHits.top1 / totalGold * 100).toFixed(0)}%  Top-3=${(llmHits.top3 / totalGold * 100).toFixed(0)}%  Top-5=${(llmHits.top5 / totalGold * 100).toFixed(0)}%`);
        }
    }

    writeFileSync(outputPath, JSON.stringify({ results, bm25Hits, llmHits, totalGold }, null, 2));
    console.error(`\n[FL] Results saved to ${outputPath}`);
}

main().catch(err => { console.error("[Salacia] fault-localizer crashed:", err); process.exit(2); });
