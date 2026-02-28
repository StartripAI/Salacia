#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "when", "where", "what", "which", "there",
  "into", "about", "after", "before", "would", "could", "should", "have", "has", "had", "been",
  "are", "was", "were", "not", "does", "doesnt", "dont", "cant", "cannot", "into", "over", "under",
  "model", "issue", "description", "example", "code", "error", "fail", "fails", "failing", "broken",
  "test", "tests", "pytest", "django", "sphinx", "sympy", "scikit", "learn", "matplotlib"
]);

function unique(values) {
  return [...new Set(values)];
}

function normalizeKeyword(token) {
  return token.replace(/^[^a-zA-Z0-9_]+|[^a-zA-Z0-9_]+$/g, "").trim();
}

function pickTopKeywords(tokens, maxKeywords) {
  const counts = new Map();
  for (const raw of tokens) {
    const token = normalizeKeyword(raw);
    if (!token) continue;
    if (token.length < 3) continue;
    if (STOPWORDS.has(token.toLowerCase())) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, maxKeywords)
    .map(([token]) => token);
}

export function extractIssueKeywords(problemStatement, maxKeywords = 16) {
  const raw = String(problemStatement || "");
  if (!raw.trim()) return [];

  const quoted = [...raw.matchAll(/[`'"]([a-zA-Z0-9_.:/-]{3,})[`'"]/g)].map((match) => match[1]);
  const symbols = [...raw.matchAll(/\b[a-zA-Z_][a-zA-Z0-9_.]{2,}\b/g)].map((match) => match[0]);
  const errors = [...raw.matchAll(/\b[A-Z][A-Za-z]+(?:Error|Exception|Warning)\b/g)].map((match) => match[0]);

  return unique(pickTopKeywords([...quoted, ...errors, ...symbols], maxKeywords));
}

function parseRgLines(rawOutput) {
  const matches = [];
  const lines = String(rawOutput || "").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^(.+?):(\d+):(.*)$/);
    if (!match) continue;
    const [, filePath, lineNumber, content] = match;
    matches.push({
      path: filePath,
      line: Number.parseInt(lineNumber, 10),
      preview: content.trim().slice(0, 200)
    });
  }
  return matches;
}

export async function searchRepo(repoPath, keywords, options = {}) {
  const maxFiles = Number.isFinite(options.maxFiles) ? options.maxFiles : 8;
  const maxHitsPerKeyword = Number.isFinite(options.maxHitsPerKeyword) ? options.maxHitsPerKeyword : 8;
  const fileMap = new Map();

  for (const keyword of keywords) {
    let result;
    try {
      result = await execFileAsync(
        "rg",
        ["-n", "-S", "--hidden", "--glob", "!.git", "--glob", "!**/.git/**", "-m", String(maxHitsPerKeyword), "--", keyword, repoPath],
        { maxBuffer: 16 * 1024 * 1024 }
      );
    } catch (error) {
      const stdout = String(error?.stdout ?? "");
      const stderr = String(error?.stderr ?? "");
      const code = typeof error?.code === "number" ? error.code : null;
      // rg returns 1 for no matches; only bubble hard failures.
      if (code !== 1 && !stdout && stderr) {
        continue;
      }
      result = { stdout };
    }

    for (const hit of parseRgLines(result?.stdout || "")) {
      const absolutePath = path.resolve(hit.path);
      if (absolutePath.includes(`${path.sep}.git${path.sep}`)) continue;
      const current = fileMap.get(absolutePath) || { path: absolutePath, hitCount: 0, sampleLines: [] };
      current.hitCount += 1;
      if (current.sampleLines.length < 6) {
        current.sampleLines.push({
          keyword,
          line: hit.line,
          preview: hit.preview
        });
      }
      fileMap.set(absolutePath, current);
    }
  }

  return [...fileMap.values()]
    .sort((a, b) => b.hitCount - a.hitCount)
    .slice(0, maxFiles);
}

function extractSymbolLines(fileText) {
  const symbols = [];
  const lines = String(fileText || "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    if (/^(class|def)\s+[A-Za-z_][A-Za-z0-9_]*/.test(line)) {
      symbols.push(`L${index + 1} ${line}`);
      continue;
    }
    if (/^(export\s+)?(async\s+)?function\s+[A-Za-z_][A-Za-z0-9_]*/.test(line)) {
      symbols.push(`L${index + 1} ${line}`);
      continue;
    }
    if (/^(export\s+)?class\s+[A-Za-z_][A-Za-z0-9_]*/.test(line)) {
      symbols.push(`L${index + 1} ${line}`);
    }
    if (symbols.length >= 8) break;
  }
  return symbols;
}

export async function buildRepoMap(fileMatches, options = {}) {
  const maxFiles = Number.isFinite(options.maxFiles) ? options.maxFiles : 8;
  const rows = [];

  for (const file of fileMatches.slice(0, maxFiles)) {
    let stat;
    try {
      stat = await fs.stat(file.path);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;

    let content = "";
    try {
      content = await fs.readFile(file.path, "utf8");
    } catch {
      // Non-text files are ignored in repo map.
      continue;
    }

    const symbols = extractSymbolLines(content);
    const suffix = symbols.length > 0 ? `\n    ${symbols.join("\n    ")}` : "";
    rows.push(`- ${file.path} (hits=${file.hitCount})${suffix}`);
  }

  return rows.join("\n");
}

function buildWindow(lines, centerLine, window = 5) {
  const start = Math.max(1, centerLine - window);
  const end = Math.min(lines.length, centerLine + window);
  const chunk = [];
  for (let line = start; line <= end; line += 1) {
    chunk.push(`L${line}: ${lines[line - 1]}`);
  }
  return chunk.join("\n");
}

export async function extractCodeSnippets(fileMatches, options = {}) {
  const maxFiles = Number.isFinite(options.maxFiles) ? options.maxFiles : 6;
  const maxChars = Number.isFinite(options.maxChars) ? options.maxChars : 12_000;
  const sections = [];
  let usedChars = 0;

  for (const file of fileMatches.slice(0, maxFiles)) {
    let content = "";
    try {
      content = await fs.readFile(file.path, "utf8");
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/);
    for (const sample of file.sampleLines.slice(0, 2)) {
      const window = buildWindow(lines, sample.line, 5);
      const section = [`# ${file.path} (${sample.keyword})`, window].join("\n");
      if (usedChars + section.length > maxChars) {
        return sections.join("\n\n");
      }
      sections.push(section);
      usedChars += section.length;
    }
  }

  return sections.join("\n\n");
}

export async function buildRepoContext(repoPath, problemStatement, options = {}) {
  const keywords = extractIssueKeywords(problemStatement, options.maxKeywords || 16);
  const relevantFiles = await searchRepo(repoPath, keywords, {
    maxFiles: options.maxFiles || 8,
    maxHitsPerKeyword: options.maxHitsPerKeyword || 8
  });
  const repoMap = await buildRepoMap(relevantFiles, { maxFiles: options.maxFiles || 8 });
  const codeSnippets = await extractCodeSnippets(relevantFiles, {
    maxFiles: options.maxSnippetFiles || 6,
    maxChars: options.maxSnippetChars || 12_000
  });

  return {
    keywords,
    relevantFiles,
    repoMap,
    codeSnippets
  };
}

