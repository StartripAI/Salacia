#!/usr/bin/env node
/**
 * analyze-campaign.mjs
 * 
 * Analyzes A/B campaign results and produces:
 *   1. Per-case-type statistics (mapped to marketing cases 1-10)
 *   2. Token savings analysis
 *   3. Failure pattern analysis (for Salacia optimization)
 *   4. FL accuracy breakdown
 *   5. Optimization recommendations
 * 
 * Usage:
 *   node scripts/benchmark/analyze-campaign.mjs \
 *     --results /tmp/salacia-oeb/ab-full-campaign \
 *     --categories /tmp/salacia-oeb/campaign-categories.json \
 *     [--fl /tmp/salacia-oeb/fl-results-merged.json]
 */
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { BASE, META, FL_PATH } from "./bench-config.mjs";

const args = process.argv.slice(2);
const resultsDir = args[args.indexOf("--results") + 1] || `${BASE}/ab-full-campaign`;
const catFile = args[args.indexOf("--categories") + 1] || `${BASE}/campaign-categories.json`;
const flFile = args.includes("--fl") ? args[args.indexOf("--fl") + 1] : FL_PATH;

// ─── Load results ───────────────────────────────────────────────────────
const results = [];
for (const d of readdirSync(resultsDir).sort()) {
    const f = join(resultsDir, d, "result.json");
    if (existsSync(f)) results.push(JSON.parse(readFileSync(f, "utf8")));
}

const categories = existsSync(catFile) ? JSON.parse(readFileSync(catFile, "utf8")) : {};
const fl = existsSync(flFile) ? JSON.parse(readFileSync(flFile, "utf8")) : { results: [] };
const flMap = Object.fromEntries(fl.results.map(r => [r.instanceId, r]));

console.log("═".repeat(70));
console.log("SALACIA CAMPAIGN ANALYSIS");
console.log(`Tasks: ${results.length} | Categories: ${Object.keys(categories).length}`);
console.log("═".repeat(70));

// ─── 1. Overall statistics ──────────────────────────────────────────────
function computeStats(data) {
    const sw = data.filter(r => r.gateResult === "scaffold-win").length;
    const bw = data.filter(r => r.gateResult === "fallback-bare").length;
    const bp = data.filter(r => r.gateResult === "both-pass").length;
    const bf = data.filter(r => r.gateResult === "both-fail").length;
    const n = data.length;
    return { sw, bw, bp, bf, n, bare: bp + bw, scaf: bp + sw };
}

const overall = computeStats(results);
console.log("\n── OVERALL ──");
console.log(`Bare:     ${overall.bare}/${overall.n} (${(overall.bare / overall.n * 100).toFixed(1)}%)`);
console.log(`Scaffold: ${overall.scaf}/${overall.n} (${(overall.scaf / overall.n * 100).toFixed(1)}%)`);
console.log(`Uplift:   ${((overall.scaf - overall.bare) / overall.n * 100).toFixed(1)}pp`);
console.log(`🏆 SW=${overall.sw}  ⚠️ FB=${overall.bw}  ✅ BP=${overall.bp}  ❌ BF=${overall.bf}`);

// ─── 2. Per-case-type statistics (mapped to marketing cases) ────────────
const caseMapping = {
    "Case 1 — Single Bug Fix": r => categories[r.instanceId]?.categories?.includes("case1_single_bug"),
    "Case 5 — Multi-file": r => categories[r.instanceId]?.categories?.includes("case5_multi_file"),
    "Case 9 — Cross-file": r => categories[r.instanceId]?.categories?.includes("case9_cross_file"),
    "Trivial complexity": r => categories[r.instanceId]?.categories?.includes("complexity_trivial"),
    "Moderate complexity": r => categories[r.instanceId]?.categories?.includes("complexity_moderate"),
    "Complex": r => categories[r.instanceId]?.categories?.includes("complexity_complex"),
    "ORM area": r => categories[r.instanceId]?.categories?.includes("area_orm"),
    "Forms area": r => categories[r.instanceId]?.categories?.includes("area_forms"),
    "Admin area": r => categories[r.instanceId]?.categories?.includes("area_admin"),
    "Template area": r => categories[r.instanceId]?.categories?.includes("area_template"),
    "Migrations area": r => categories[r.instanceId]?.categories?.includes("area_migrations"),
    "Single test": r => categories[r.instanceId]?.categories?.includes("tests_single"),
    "Few tests (2-5)": r => categories[r.instanceId]?.categories?.includes("tests_few"),
    "Many tests (>5)": r => categories[r.instanceId]?.categories?.includes("tests_many"),
};

console.log("\n── PER-CATEGORY ──");
console.log(`${"Category".padEnd(25)} ${"N".padStart(4)} ${"Bare".padStart(6)} ${"Scaf".padStart(6)} ${"Diff".padStart(7)} ${"SW".padStart(3)} ${"FB".padStart(3)} ${"BF".padStart(3)}`);
console.log("─".repeat(65));
for (const [name, filter] of Object.entries(caseMapping)) {
    const subset = results.filter(filter);
    if (subset.length === 0) continue;
    const s = computeStats(subset);
    const bareP = (s.bare / s.n * 100).toFixed(0);
    const scafP = (s.scaf / s.n * 100).toFixed(0);
    const diff = ((s.scaf - s.bare) / s.n * 100).toFixed(1);
    console.log(`${name.padEnd(25)} ${String(s.n).padStart(4)} ${(bareP + "%").padStart(6)} ${(scafP + "%").padStart(6)} ${(diff + "pp").padStart(7)} ${String(s.sw).padStart(3)} ${String(s.bw).padStart(3)} ${String(s.bf).padStart(3)}`);
}

// ─── 3. Token savings analysis (Case 10) ────────────────────────────────
console.log("\n── TOKEN ANALYSIS (Case 10) ──");
let totalBareTok = 0, totalScafTok = 0;
let bareTokArr = [], scafTokArr = [];
let bareOnlyTok = 0, scafOnlyTok = 0;
for (const r of results) {
    const bt = r.bare?.tokens?.total || 0;
    const st = r.scaffold?.tokens?.total || 0;
    totalBareTok += bt;
    totalScafTok += st;
    bareTokArr.push(bt);
    scafTokArr.push(st);

    if (r.gateResult === "scaffold-win") scafOnlyTok += st;
    if (r.gateResult === "fallback-bare") bareOnlyTok += bt;
}
const avgBare = totalBareTok / results.length;
const avgScaf = totalScafTok / results.length;
console.log(`  Avg tokens/task (bare):     ${avgBare.toFixed(0)}`);
console.log(`  Avg tokens/task (scaffold): ${avgScaf.toFixed(0)}`);
console.log(`  Token diff:                 ${((avgScaf - avgBare) / avgBare * 100).toFixed(1)}%`);

// For successful tasks only
const passedBare = results.filter(r => r.bare?.passed);
const passedScaf = results.filter(r => r.scaffold?.passed);
if (passedBare.length > 0 && passedScaf.length > 0) {
    const avgBarePass = passedBare.reduce((s, r) => s + (r.bare?.tokens?.total || 0), 0) / passedBare.length;
    const avgScafPass = passedScaf.reduce((s, r) => s + (r.scaffold?.tokens?.total || 0), 0) / passedScaf.length;
    console.log(`  Avg tokens/PASS (bare):     ${avgBarePass.toFixed(0)} (${passedBare.length} tasks)`);
    console.log(`  Avg tokens/PASS (scaffold): ${avgScafPass.toFixed(0)} (${passedScaf.length} tasks)`);
    console.log(`  Token savings on success:   ${((avgScafPass - avgBarePass) / avgBarePass * 100).toFixed(1)}%`);
}

// Turns comparison
const avgBareTurns = results.reduce((s, r) => s + (r.bare?.turns || 0), 0) / results.length;
const avgScafTurns = results.reduce((s, r) => s + (r.scaffold?.turns || 0), 0) / results.length;
console.log(`  Avg turns (bare):           ${avgBareTurns.toFixed(1)}`);
console.log(`  Avg turns (scaffold):       ${avgScafTurns.toFixed(1)}`);

// ─── 4. FL accuracy on this campaign ────────────────────────────────────
console.log("\n── FL ACCURACY ──");
let flHit1 = 0, flHit5 = 0, flTotal = 0;
for (const r of results) {
    const goldPath = `${META}/${r.instanceId}/gold-patch.diff`;
    if (!existsSync(goldPath)) continue;
    const gold = readFileSync(goldPath, "utf8");
    const goldFiles = [...gold.matchAll(/diff --git a\/(.+?) b\//g)].map(m => m[1]);

    const entry = flMap[r.instanceId];
    if (!entry) continue;
    const flFiles = entry.finalTop5 || entry.bm25Top5 || [];

    flTotal++;
    // Exact match: full path equal, or FL path ends with /goldBasename
    const exactMatch = (flPath, goldPath) => {
        if (flPath === goldPath) return true;
        const goldBase = goldPath.split("/").pop();
        const flBase = flPath.split("/").pop();
        return goldBase === flBase;  // exact basename match, not substring
    };
    if (flFiles.length > 0 && goldFiles.some(g => exactMatch(flFiles[0], g))) flHit1++;
    if (goldFiles.some(g => flFiles.some(f => exactMatch(f, g)))) flHit5++;
}
if (flTotal > 0) {
    console.log(`  Top-1: ${flHit1}/${flTotal} (${(flHit1 / flTotal * 100).toFixed(0)}%)`);
    console.log(`  Top-5: ${flHit5}/${flTotal} (${(flHit5 / flTotal * 100).toFixed(0)}%)`);
}

// ─── 5. Failure pattern analysis (for optimization) ─────────────────────
console.log("\n── FAILURE ANALYSIS (for Salacia optimization) ──");
const bothFail = results.filter(r => r.gateResult === "both-fail");
const fallbacks = results.filter(r => r.gateResult === "fallback-bare");

console.log(`\n  Both-fail (${bothFail.length}):`);
const bfByArea = {};
for (const r of bothFail) {
    const cat = categories[r.instanceId];
    if (!cat) continue;
    for (const a of cat.areas) {
        bfByArea[a] = (bfByArea[a] || 0) + 1;
    }
}
for (const [a, c] of Object.entries(bfByArea).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${a.padEnd(15)} ${c}`);
}

console.log(`\n  Fallbacks (${fallbacks.length}):`);
for (const r of fallbacks) {
    const entry = flMap[r.instanceId];
    const flFiles = entry?.finalTop5 || [];
    const goldPath = `${META}/${r.instanceId}/gold-patch.diff`;
    let goldFiles = [];
    if (existsSync(goldPath)) {
        const gold = readFileSync(goldPath, "utf8");
        goldFiles = [...gold.matchAll(/diff --git a\/(.+?) b\//g)].map(m => m[1]);
    }
    const flCorrect = goldFiles.some(g => flFiles.some(f => f.includes(g)));
    console.log(`    ${r.instanceId}: FL=${flCorrect ? "✅" : "❌"} gold=${goldFiles[0] || "?"}`);
}

// ─── 6. Optimization recommendations ───────────────────────────────────
console.log("\n── OPTIMIZATION OPPORTUNITIES ──");

// Categories where scaffold helps most
const categoryUplift = [];
for (const [name, filter] of Object.entries(caseMapping)) {
    const subset = results.filter(filter);
    if (subset.length < 5) continue;
    const s = computeStats(subset);
    const uplift = (s.scaf - s.bare) / s.n;
    categoryUplift.push({ name, uplift, n: s.n, sw: s.sw, bw: s.bw });
}
categoryUplift.sort((a, b) => b.uplift - a.uplift);
console.log("\n  Categories where scaffold helps MOST:");
for (const c of categoryUplift.slice(0, 5)) {
    console.log(`    ${c.name.padEnd(25)} ${(c.uplift * 100).toFixed(1)}pp (${c.sw} wins, n=${c.n})`);
}
console.log("\n  Categories where scaffold helps LEAST:");
for (const c of categoryUplift.slice(-3)) {
    console.log(`    ${c.name.padEnd(25)} ${(c.uplift * 100).toFixed(1)}pp (${c.bw} fallbacks, n=${c.n})`);
}

// Both-fail tasks with correct FL = optimization targets
const optimTargets = bothFail.filter(r => {
    const entry = flMap[r.instanceId];
    const flFiles = entry?.finalTop5 || [];
    const goldPath = `${META}/${r.instanceId}/gold-patch.diff`;
    if (!existsSync(goldPath)) return false;
    const gold = readFileSync(goldPath, "utf8");
    const goldFiles = [...gold.matchAll(/diff --git a\/(.+?) b\//g)].map(m => m[1]);
    return goldFiles.some(g => flFiles.some(f => f.includes(g)));
});
console.log(`\n  🎯 High-value optimization targets: ${optimTargets.length}`);
console.log("  (FL found the right file, but agent couldn't fix it)");
console.log("  → These tasks benefit from: better scaffold prompt, more turns, or code analysis hints");
for (const r of optimTargets.slice(0, 10)) {
    console.log(`    ${r.instanceId}`);
}

console.log("\n" + "═".repeat(70));
