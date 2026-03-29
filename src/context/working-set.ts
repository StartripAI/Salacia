import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ContextPackFileMatch, WorkingSetSummary } from "../core/types.js";

const execFileAsync = promisify(execFile);

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "when", "where", "what", "which", "there",
  "into", "about", "after", "before", "would", "could", "should", "have", "has", "had", "been",
  "are", "was", "were", "not", "does", "doesnt", "dont", "cant", "cannot", "into", "over", "under",
  "model", "issue", "description", "example", "code", "error", "fail", "fails", "failing", "broken",
  "test", "tests", "pytest", "django", "sphinx", "sympy", "scikit", "learn", "matplotlib"
]);

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeKeyword(token: string): string {
  return token.replace(/^[^a-zA-Z0-9_]+|[^a-zA-Z0-9_]+$/g, "").trim();
}

function pickTopKeywords(tokens: string[], maxKeywords: number): string[] {
  const counts = new Map<string, number>();
  for (const raw of tokens) {
    const token = normalizeKeyword(raw);
    if (!token || token.length < 3 || STOPWORDS.has(token.toLowerCase())) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, maxKeywords)
    .map(([token]) => token);
}

export function extractWorkingSetKeywords(problemStatement: string, maxKeywords = 16): string[] {
  const raw = String(problemStatement || "");
  if (!raw.trim()) return [];

  const quoted = [...raw.matchAll(/[`'"]([a-zA-Z0-9_.:/-]{3,})[`'"]/g)].map((match) => match[1] as string);
  const symbols = [...raw.matchAll(/\b[a-zA-Z_][a-zA-Z0-9_.]{2,}\b/g)].map((match) => match[0] as string);
  const errors = [...raw.matchAll(/\b[A-Z][A-Za-z]+(?:Error|Exception|Warning)\b/g)].map((match) => match[0] as string);

  return unique(pickTopKeywords([...quoted, ...errors, ...symbols], maxKeywords));
}

function parseRgLines(rawOutput: string) {
  const matches: Array<{ path: string; line: number; preview: string }> = [];
  const lines = String(rawOutput || "").split(/\r?\n/g);
  for (const line of lines) {
    const match = line.match(/^(.+?):(\d+):(.*)$/);
    if (!match) continue;
    matches.push({
      path: match[1] as string,
      line: Number.parseInt(match[2] as string, 10),
      preview: (match[3] as string).trim().slice(0, 200)
    });
  }
  return matches;
}

export async function searchWorkingSet(
  repoPath: string,
  keywords: string[],
  options: { maxFiles?: number; maxHitsPerKeyword?: number } = {}
): Promise<ContextPackFileMatch[]> {
  const maxFiles = Number.isFinite(options.maxFiles) ? options.maxFiles : 8;
  const maxHitsPerKeyword = Number.isFinite(options.maxHitsPerKeyword) ? options.maxHitsPerKeyword : 8;
  const fileMap = new Map<string, ContextPackFileMatch>();

  for (const keyword of keywords) {
    let stdout = "";
    try {
      const result = await execFileAsync(
        "rg",
        [
          "-n",
          "-S",
          "--hidden",
          "--glob",
          "!.git",
          "--glob",
          "!**/.git/**",
          "--glob",
          "!**/.salacia/**",
          "--glob",
          "!node_modules/**",
          "--glob",
          "!dist/**",
          "--glob",
          "!third_party/**",
          "-m",
          String(maxHitsPerKeyword),
          "--",
          keyword,
          repoPath
        ],
        { maxBuffer: 16 * 1024 * 1024 }
      );
      stdout = String(result.stdout || "");
    } catch (error) {
      const err = error as { stdout?: string; code?: number };
      if (err.code !== 1) {
        stdout = String(err.stdout || "");
      }
    }

    for (const hit of parseRgLines(stdout)) {
      const absolutePath = path.resolve(hit.path);
      const current = fileMap.get(absolutePath) ?? {
        path: absolutePath,
        hitCount: 0,
        sampleLines: []
      };
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

function buildWindow(lines: string[], centerLine: number, window = 5): string {
  const start = Math.max(1, centerLine - window);
  const end = Math.min(lines.length, centerLine + window);
  const chunk: string[] = [];
  for (let line = start; line <= end; line += 1) {
    chunk.push(`L${line}: ${lines[line - 1]}`);
  }
  return chunk.join("\n");
}

export async function extractWorkingSetSnippets(
  fileMatches: ContextPackFileMatch[],
  options: { maxFiles?: number; maxChars?: number } = {}
): Promise<string> {
  const maxFiles = typeof options.maxFiles === "number" && Number.isFinite(options.maxFiles) ? options.maxFiles : 6;
  const maxChars = typeof options.maxChars === "number" && Number.isFinite(options.maxChars) ? options.maxChars : 12_000;
  const sections: string[] = [];
  let usedChars = 0;

  for (const file of fileMatches.slice(0, maxFiles)) {
    const content = await fs.readFile(file.path, "utf8").catch(() => "");
    if (!content) continue;
    const lines = content.split(/\r?\n/);
    for (const sample of file.sampleLines.slice(0, 2)) {
      const section = [`# ${file.path} (${sample.keyword})`, buildWindow(lines, sample.line, 5)].join("\n");
      if (usedChars + section.length > maxChars) {
        return sections.join("\n\n");
      }
      sections.push(section);
      usedChars += section.length;
    }
  }

  return sections.join("\n\n");
}

export async function buildWorkingSet(
  repoPath: string,
  problemStatement: string,
  options: { maxKeywords?: number; maxFiles?: number; maxHitsPerKeyword?: number; maxSnippetChars?: number } = {}
): Promise<WorkingSetSummary> {
  const keywords = extractWorkingSetKeywords(problemStatement, options.maxKeywords ?? 16);
  const relevantFiles = await searchWorkingSet(repoPath, keywords, {
    maxFiles: options.maxFiles ?? 8,
    maxHitsPerKeyword: options.maxHitsPerKeyword ?? 8
  });
  const codeSnippets = await extractWorkingSetSnippets(relevantFiles, {
    maxFiles: options.maxFiles ?? 6,
    maxChars: options.maxSnippetChars ?? 12_000
  });

  return {
    keywords,
    relevantFiles,
    codeSnippets
  };
}
