/**
 * bench-config.mjs — Shared configuration for all Salacia benchmark scripts
 * 
 * All paths, repo configs, and environment settings in one place.
 * 
 * Usage:
 *   import { BASE, META, WS_PREFIX, VENVS, REPO_CONFIG, FL_PATH } from "./bench-config.mjs";
 * 
 * Override:
 *   Set SALACIA_OEB_DIR env var to change the base directory.
 *   Default: /tmp/salacia-oeb
 */

// ─── Base directory (overridable via env) ───────────────────────────────
export const BASE = process.env.SALACIA_OEB_DIR || "/tmp/salacia-oeb";
export const META = `${BASE}/meta`;
export const WS_PREFIX = `${BASE}/ws2-`;
export const VENVS = `${BASE}/venvs`;
export const FL_PATH = `${BASE}/fl-results-merged.json`;

// ─── Python binary (overridable via env) ────────────────────────────────
import { execSync } from "node:child_process";

function detectPython() {
    if (process.env.SALACIA_PYTHON) return process.env.SALACIA_PYTHON;
    // Try common locations
    const candidates = [
        "python3.10",
        "/Users/star/.pyenv/versions/3.10.19/bin/python3.10",
        "python3",
        "python",
    ];
    for (const c of candidates) {
        try {
            execSync(`${c} --version`, { stdio: "ignore", timeout: 3000 });
            return c;
        } catch { /* not found */ }
    }
    return "python3"; // last resort
}
export const PYTHON_BIN = detectPython();

// ─── Repo-specific configurations ──────────────────────────────────────
export const REPO_CONFIG = {
    django: { venv: "django", pp: "workspace", testMode: "runtests" },
    sympy: { venv: "sympy", pp: "workspace", testMode: "direct" },
    "pylint-dev": { venv: "pylint", pp: "workspace", testMode: "pytest" },
    "pytest-dev": { venv: "pytest", pp: "workspace", testMode: "pytest" },
    matplotlib: { venv: "matplotlib39", pp: "workspace_lib", testMode: "pytest_mpl" },
    pallets: { venv: "flask", pp: "workspace", testMode: "pytest" },
    psf: { venv: "requests39", pp: "workspace", testMode: "pytest" },
    "scikit-learn": { venv: "sklearn", pp: "workspace", testMode: "pytest_sklearn" },
    pydata: { venv: "xarray", pp: "workspace", testMode: "pytest" },
    astropy: { venv: "astropy", pp: "workspace", testMode: "pytest_astropy" },
    mwaskom: { venv: "seaborn", pp: "workspace", testMode: "pytest" },
    "sphinx-doc": { venv: "sphinx", pp: "workspace", testMode: "pytest" },
};

// ─── Get config for a task ID ───────────────────────────────────────────
export function getRepoConfig(instanceId) {
    const prefix = instanceId.split("__")[0];
    return REPO_CONFIG[prefix] || { venv: prefix, pp: "workspace", testMode: "pytest" };
}

// ─── Default output dir generators ─────────────────────────────────────
export function defaultOutputDir(prefix = "ab") {
    return `${BASE}/${prefix}-${Date.now()}`;
}

export function defaultFLOutput() {
    return `${BASE}/fl-results.json`;
}

// ─── Safe workspace cleanup ─────────────────────────────────────────────
import { readdirSync, statSync, rmSync } from "node:fs";
import path from "node:path";

/**
 * Safely clean up workspace directories.
 * Lists what will be deleted before doing it.
 * @param {object} opts
 * @param {boolean} opts.force - Actually delete (otherwise dry-run)
 * @param {boolean} opts.keepResults - Keep ab-* result directories
 * @returns {{ removed: string[], kept: string[], totalMB: number }}
 */
export function cleanWorkspaces({ force = false, keepResults = true } = {}) {
    const removed = [], kept = [];
    let totalBytes = 0;

    const entries = readdirSync(BASE);
    for (const e of entries) {
        const fp = path.join(BASE, e);
        let st;
        try { st = statSync(fp); } catch { continue; }
        if (!st.isDirectory()) continue;

        // Protect result directories
        if (keepResults && (e.startsWith("ab-") || e === "meta" || e === "venvs")) {
            kept.push(e);
            continue;
        }

        // Only delete workspace dirs (ws2-*)
        if (!e.startsWith("ws2-")) {
            kept.push(e);
            continue;
        }

        if (force) {
            try { rmSync(fp, { recursive: true, force: true }); } catch { /* ignore */ }
        }
        removed.push(e);
    }

    return { removed, kept, totalMB: 0 };
}

// ─── Gate decision helpers ──────────────────────────────────────────────
export function gateDecision(barePassed, scaffoldPassed) {
    if (scaffoldPassed && !barePassed) return "scaffold-win";
    if (scaffoldPassed && barePassed) return "both-pass";
    if (!scaffoldPassed && barePassed) return "fallback-bare";
    return "both-fail";
}

export function gateIcon(result) {
    return { "scaffold-win": "🏆", "both-pass": "✅", "fallback-bare": "⚠️", "both-fail": "❌" }[result] || "?";
}
