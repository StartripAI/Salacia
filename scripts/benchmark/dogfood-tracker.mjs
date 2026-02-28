#!/usr/bin/env node
/**
 * dogfood-tracker.mjs — Record & analyze Salacia dogfood sessions
 * 
 * Usage:
 *   node scripts/benchmark/dogfood-tracker.mjs log \
 *     --case 1 --task "Fix BM25 bug" --mode scaffold --result pass \
 *     --tokens 5000 --turns 3 --time 4.5
 *   
 *   node scripts/benchmark/dogfood-tracker.mjs report
 *   
 *   node scripts/benchmark/dogfood-tracker.mjs stats
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { BASE } from "./bench-config.mjs";

const LOG_PATH = `${BASE}/dogfood-sessions.json`;

function loadSessions() {
    if (!existsSync(LOG_PATH)) return [];
    return JSON.parse(readFileSync(LOG_PATH, "utf8"));
}

function saveSessions(sessions) {
    mkdirSync(BASE, { recursive: true });
    writeFileSync(LOG_PATH, JSON.stringify(sessions, null, 2));
}

function logSession(args) {
    const session = {
        date: new Date().toISOString().split("T")[0],
        case: null,
        task: "",
        mode: "scaffold",
        model: process.env.SALACIA_MODEL || "unknown",
        tokens: 0,
        turns: 0,
        timeMinutes: 0,
        result: "pass",
        notes: "",
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case "--case": session.case = Number(args[++i]); break;
            case "--task": session.task = args[++i]; break;
            case "--mode": session.mode = args[++i]; break;
            case "--model": session.model = args[++i]; break;
            case "--tokens": session.tokens = Number(args[++i]); break;
            case "--turns": session.turns = Number(args[++i]); break;
            case "--time": session.timeMinutes = Number(args[++i]); break;
            case "--result": session.result = args[++i]; break;
            case "--notes": session.notes = args[++i]; break;
        }
    }

    const sessions = loadSessions();
    sessions.push(session);
    saveSessions(sessions);
    console.log(`✅ Session #${sessions.length} logged: Case ${session.case} — ${session.task} [${session.result}]`);
}

function printReport() {
    const sessions = loadSessions();
    if (sessions.length === 0) {
        console.log("No sessions logged yet.");
        return;
    }

    console.log("═".repeat(60));
    console.log(`SALACIA DOGFOOD REPORT — ${sessions.length} sessions`);
    console.log("═".repeat(60));

    // Per-case summary
    const cases = {};
    for (const s of sessions) {
        const c = s.case || "?";
        if (!cases[c]) cases[c] = { total: 0, pass: 0, tokens: 0, turns: 0, time: 0 };
        cases[c].total++;
        if (s.result === "pass") cases[c].pass++;
        cases[c].tokens += s.tokens;
        cases[c].turns += s.turns;
        cases[c].time += s.timeMinutes;
    }

    console.log(`\n${"Case".padEnd(8)} ${"N".padStart(4)} ${"Pass".padStart(6)} ${"AvgTok".padStart(8)} ${"AvgTurns".padStart(9)} ${"AvgMin".padStart(7)}`);
    console.log("─".repeat(45));
    for (const [c, d] of Object.entries(cases).sort((a, b) => Number(a[0]) - Number(b[0]))) {
        const passP = `${Math.round(d.pass / d.total * 100)}%`;
        console.log(`Case ${String(c).padEnd(3)} ${String(d.total).padStart(4)} ${passP.padStart(6)} ${String(Math.round(d.tokens / d.total)).padStart(8)} ${(d.turns / d.total).toFixed(1).padStart(9)} ${(d.time / d.total).toFixed(1).padStart(7)}`);
    }

    // Totals
    const total = sessions.length;
    const passed = sessions.filter(s => s.result === "pass").length;
    const totalTok = sessions.reduce((s, x) => s + x.tokens, 0);
    console.log(`\nTotal:   ${total} sessions, ${passed} passed (${Math.round(passed / total * 100)}%)`);
    console.log(`Tokens:  ${totalTok} total, ${Math.round(totalTok / total)} avg/session`);

    // Timeline
    console.log("\nTimeline:");
    for (const s of sessions) {
        const icon = s.result === "pass" ? "✅" : "❌";
        console.log(`  ${s.date} ${icon} Case ${s.case} — ${s.task}`);
    }
}

function printStats() {
    const sessions = loadSessions();
    const scaffold = sessions.filter(s => s.mode === "scaffold");
    const bare = sessions.filter(s => s.mode === "bare");

    console.log("═".repeat(50));
    console.log("DOGFOOD A/B COMPARISON");
    console.log("═".repeat(50));

    if (bare.length === 0) {
        console.log("No bare sessions yet. Both modes needed for comparison.");
        console.log(`Scaffold sessions: ${scaffold.length}`);
        return;
    }

    const avgTokScaf = scaffold.reduce((s, x) => s + x.tokens, 0) / scaffold.length;
    const avgTokBare = bare.reduce((s, x) => s + x.tokens, 0) / bare.length;
    const passScaf = scaffold.filter(s => s.result === "pass").length / scaffold.length;
    const passBare = bare.filter(s => s.result === "pass").length / bare.length;

    console.log(`\n${"".padEnd(15)} ${"Bare".padStart(10)} ${"Scaffold".padStart(10)} ${"Diff".padStart(10)}`);
    console.log("─".repeat(48));
    console.log(`${"Sessions".padEnd(15)} ${String(bare.length).padStart(10)} ${String(scaffold.length).padStart(10)}`);
    console.log(`${"Pass Rate".padEnd(15)} ${(passBare * 100).toFixed(0).padStart(9)}% ${(passScaf * 100).toFixed(0).padStart(9)}% ${((passScaf - passBare) * 100).toFixed(1).padStart(8)}pp`);
    console.log(`${"Avg Tokens".padEnd(15)} ${avgTokBare.toFixed(0).padStart(10)} ${avgTokScaf.toFixed(0).padStart(10)} ${((avgTokScaf - avgTokBare) / avgTokBare * 100).toFixed(1).padStart(9)}%`);
}

// ─── Main ──────────────────────────────────────────────────────────────
const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
    case "log": logSession(rest); break;
    case "report": printReport(); break;
    case "stats": printStats(); break;
    default:
        console.log("Usage: dogfood-tracker.mjs <log|report|stats> [options]");
        console.log("  log    --case N --task '...' --mode scaffold|bare --result pass|fail --tokens N --turns N --time N");
        console.log("  report   Show all sessions and per-case summary");
        console.log("  stats    Compare bare vs scaffold performance");
}
