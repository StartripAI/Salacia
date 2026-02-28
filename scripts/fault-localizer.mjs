#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CODE_EXT_RE = /\.(py|ts|tsx|js|jsx|go|rs|java|kt|rb|php|c|cc|cpp|h|hpp|cs)$/i;
const TEST_HINT_RE = /(^|\/)(test|tests|spec|specs)(\/|$)|(_test|\.test|\.spec)\./i;
const DOC_HINT_RE = /(^|\/)(docs?|documentation)(\/|$)|\.(md|rst|txt)$/i;
const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "when", "where", "what", "which", "there",
  "into", "about", "after", "before", "would", "could", "should", "have", "has", "had", "been",
  "are", "was", "were", "not", "does", "doesnt", "dont", "cant", "cannot", "issue", "description"
]);

function unique(values) {
  return [...new Set(values)];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeToken(token) {
  return token.replace(/^[^a-zA-Z0-9_./-]+|[^a-zA-Z0-9_./-]+$/g, "").trim();
}

function pickTopTokens(tokens, maxTokens = 24) {
  const counts = new Map();
  for (const raw of tokens) {
    const token = normalizeToken(raw);
    if (!token || token.length < 3) continue;
    if (STOPWORDS.has(token.toLowerCase())) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, maxTokens)
    .map(([token]) => token);
}

export function extractFaultSignals(problemStatement, hintsText = "") {
  const combined = `${String(problemStatement || "")}\n${String(hintsText || "")}`;

  const explicitPaths = [
    ...combined.matchAll(/\b(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\b/g)
  ].map((m) => m[0]);

  const quoted = [...combined.matchAll(/[`'"]([a-zA-Z0-9_.:/-]{3,})[`'"]/g)].map((m) => m[1]);
  const symbols = [...combined.matchAll(/\b[a-zA-Z_][a-zA-Z0-9_.]{2,}\b/g)].map((m) => m[0]);
  const errors = [...combined.matchAll(/\b[A-Z][A-Za-z]+(?:Error|Exception|Warning)\b/g)].map((m) => m[0]);
  const exploded = unique(
    [...symbols, ...explicitPaths, ...quoted]
      .flatMap((item) => item.split(/[.:/]/g))
      .map((item) => item.trim())
      .filter((item) => item.length >= 3)
  );

  const tokens = pickTopTokens([...explicitPaths, ...quoted, ...symbols, ...errors, ...exploded], 32);
  const queries = unique([...errors, ...explicitPaths, ...tokens]).slice(0, 24);

  return {
    queries,
    explicitPaths: unique(explicitPaths).slice(0, 12),
    symbols: unique(symbols).slice(0, 24),
    errors: unique(errors).slice(0, 12)
  };
}

function parseRgLines(raw) {
  const out = [];
  for (const line of String(raw || "").split(/\r?\n/)) {
    const match = line.match(/^(.+?):(\d+):(.*)$/);
    if (!match) continue;
    out.push({
      path: path.resolve(match[1]),
      line: Number.parseInt(match[2], 10),
      preview: match[3].trim().slice(0, 240)
    });
  }
  return out;
}

async function runRg(repoPath, query, maxHitsPerQuery) {
  try {
    const { stdout } = await execFileAsync(
      "rg",
      [
        "-n",
        "-S",
        "--hidden",
        "--glob",
        "!.git",
        "--glob",
        "!**/.git/**",
        "-m",
        String(maxHitsPerQuery),
        "--",
        query,
        repoPath
      ],
      { maxBuffer: 32 * 1024 * 1024 }
    );
    return parseRgLines(stdout);
  } catch (error) {
    // rg returns code 1 on no-match.
    if (typeof error?.code === "number" && error.code === 1) {
      return [];
    }
    return [];
  }
}

function scorePath(filePath) {
  let score = 0;
  if (CODE_EXT_RE.test(filePath)) score += 35;
  if (TEST_HINT_RE.test(filePath)) score += 10;
  if (DOC_HINT_RE.test(filePath)) score -= 25;
  return score;
}

function scoreHit(hit, signals, query) {
  let score = scorePath(hit.path);
  const previewLower = hit.preview.toLowerCase();
  const pathLower = hit.path.toLowerCase();

  if (signals.explicitPaths.some((p) => pathLower.endsWith(p.toLowerCase()))) score += 45;
  if (signals.errors.some((e) => hit.preview.includes(e))) score += 25;
  if (signals.symbols.some((s) => previewLower.includes(s.toLowerCase()))) score += 12;
  if (previewLower.includes(query.toLowerCase())) score += 8;
  if (hit.line <= 200) score += 4;

  return score;
}

function buildSnippet(lines, centerLine, window = 20) {
  const start = clamp(centerLine - window, 1, lines.length);
  const end = clamp(centerLine + window, 1, lines.length);
  const chunk = [];
  for (let n = start; n <= end; n += 1) {
    chunk.push(`L${n}: ${lines[n - 1]}`);
  }
  return chunk.join("\n");
}

async function buildSnippets(rankedFiles, maxFiles = 5, maxChars = 14_000) {
  const sections = [];
  let used = 0;

  for (const file of rankedFiles.slice(0, maxFiles)) {
    let content = "";
    try {
      content = await fs.readFile(file.path, "utf8");
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/);
    for (const sample of file.sampleLines.slice(0, 2)) {
      const section = [
        `# ${file.path}`,
        `# score=${file.score} line=${sample.line}`,
        buildSnippet(lines, sample.line, 15)
      ].join("\n");

      if (used + section.length > maxChars) {
        return sections.join("\n\n");
      }
      used += section.length;
      sections.push(section);
    }
  }

  return sections.join("\n\n");
}

export async function localizeFault(repoPath, problemStatement, hintsText = "", options = {}) {
  const maxHitsPerQuery = Number.isFinite(options.maxHitsPerQuery) ? options.maxHitsPerQuery : 10;
  const maxFiles = Number.isFinite(options.maxFiles) ? options.maxFiles : 8;
  const maxSnippets = Number.isFinite(options.maxSnippets) ? options.maxSnippets : 5;

  const signals = extractFaultSignals(problemStatement, hintsText);
  const perFile = new Map();

  for (const query of signals.queries) {
    const hits = await runRg(repoPath, query, maxHitsPerQuery);
    for (const hit of hits) {
      if (hit.path.includes(`${path.sep}.git${path.sep}`)) continue;
      const current = perFile.get(hit.path) || {
        path: hit.path,
        score: 0,
        hitCount: 0,
        sampleLines: []
      };
      const hitScore = scoreHit(hit, signals, query);
      current.score += hitScore;
      current.hitCount += 1;
      if (current.sampleLines.length < 8) {
        current.sampleLines.push({
          query,
          line: hit.line,
          preview: hit.preview,
          score: hitScore
        });
      }
      perFile.set(hit.path, current);
    }
  }

  const rankedFiles = [...perFile.values()]
    .sort((a, b) => b.score - a.score || b.hitCount - a.hitCount)
    .slice(0, maxFiles);

  const snippets = await buildSnippets(rankedFiles, maxSnippets, options.maxSnippetChars || 14_000);

  return {
    queries: signals.queries,
    signals,
    rankedFiles,
    snippets
  };
}
