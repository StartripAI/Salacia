import fs from "node:fs/promises";
import { basename } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ContextPackFileMatch, RankedRepoFile, RankedRepoSymbol, RepoMapSummary } from "../core/types.js";

const execFileAsync = promisify(execFile);

const FALLBACK_PATTERNS = [
  { kind: "function", regex: /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)/ },
  { kind: "class", regex: /^(?:export\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)/ },
  { kind: "method", regex: /^(?:async\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/ },
  { kind: "function", regex: /^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/ },
  { kind: "class", regex: /^class\s+([A-Za-z_][A-Za-z0-9_]*)/ }
];

function tokenize(value: string): string[] {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

async function hasTreeSitterCli(): Promise<boolean> {
  try {
    await execFileAsync("tree-sitter", ["--version"], { timeout: 5_000, maxBuffer: 1024 * 1024 });
    return true;
  } catch {
    return false;
  }
}

async function extractSymbols(filePath: string, maxSymbols: number, useTreeSitter: boolean): Promise<RankedRepoSymbol[]> {
  if (useTreeSitter) {
    try {
      const { stdout } = await execFileAsync("tree-sitter", ["tags", filePath], {
        timeout: 20_000,
        maxBuffer: 8 * 1024 * 1024
      });
      const out: RankedRepoSymbol[] = [];
      for (const line of String(stdout || "").split(/\r?\n/g)) {
        const parts = line.split("\t").map((item) => item.trim()).filter(Boolean);
        if (parts.length === 0) continue;
        const name = parts[0] as string;
        const loc = parts.find((part) => /^\d+([:.,]\d+)?$/.test(part));
        const lineNumber = loc ? Number.parseInt(loc.split(/[:.,]/)[0] as string, 10) : 1;
        out.push({
          filePath,
          name,
          kind: "symbol",
          line: lineNumber,
          rank: 0
        });
        if (out.length >= maxSymbols) break;
      }
      return out;
    } catch {
      return [];
    }
  }

  const content = await fs.readFile(filePath, "utf8").catch(() => "");
  const out: RankedRepoSymbol[] = [];
  for (const [index, line] of content.split(/\r?\n/g).entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    for (const pattern of FALLBACK_PATTERNS) {
      const match = trimmed.match(pattern.regex);
      if (!match) continue;
      out.push({
        filePath,
        name: match[1] as string,
        kind: pattern.kind,
        line: index + 1,
        rank: 0
      });
      break;
    }
    if (out.length >= maxSymbols) break;
  }
  return out;
}

function buildRankedText(topFiles: RankedRepoFile[], topSymbols: RankedRepoSymbol[]): string {
  const lines = ["Top files:"];
  for (const file of topFiles) {
    lines.push(`- [rank=${file.rank.toFixed(4)} hits=${file.hitCount}] ${file.path}`);
  }
  lines.push("", "Top symbols:");
  for (const symbol of topSymbols) {
    lines.push(`- [rank=${symbol.rank.toFixed(4)}] ${symbol.filePath}:${symbol.line} ${symbol.kind} ${symbol.name}`);
  }
  return lines.join("\n");
}

export async function buildRankedRepoMap(
  rankedFiles: ContextPackFileMatch[],
  options: { maxFiles?: number; maxSymbols?: number } = {}
): Promise<RepoMapSummary> {
  const maxFiles = typeof options.maxFiles === "number" && Number.isFinite(options.maxFiles) ? options.maxFiles : 8;
  const maxSymbols =
    typeof options.maxSymbols === "number" && Number.isFinite(options.maxSymbols) ? options.maxSymbols : 20;
  const files = rankedFiles.slice(0, maxFiles);
  const engine: "tree-sitter" | "fallback-regex" = (await hasTreeSitterCli()) ? "tree-sitter" : "fallback-regex";

  const topFiles: RankedRepoFile[] = files.map((file, index) => ({
    path: file.path,
    hitCount: file.hitCount,
    rank: Number((1 - index / Math.max(1, files.length)).toFixed(4))
  }));

  const topSymbols: RankedRepoSymbol[] = [];
  for (const file of files) {
    const queryTokens = Array.from(
      new Set([
        ...tokenize(basename(file.path)),
        ...file.sampleLines.flatMap((sample) => tokenize(`${sample.keyword} ${sample.preview}`))
      ])
    );
    const symbols = await extractSymbols(file.path, Math.max(4, Math.ceil(maxSymbols / Math.max(1, files.length))), engine === "tree-sitter");
    for (const symbol of symbols) {
      const score = queryTokens.some((token) => symbol.name.toLowerCase().includes(token)) ? 1 : 0.5;
      topSymbols.push({
        ...symbol,
        rank: Number(score.toFixed(4))
      });
    }
  }

  topSymbols.sort((a, b) => b.rank - a.rank || a.filePath.localeCompare(b.filePath));
  const limitedSymbols = topSymbols.slice(0, maxSymbols);

  const text = [
    "Repo map summary:",
    ...topFiles.map((file) => `- ${file.path} (hits=${file.hitCount})`),
    "",
    ...limitedSymbols.map((symbol) => `- ${symbol.filePath}:${symbol.line} ${symbol.kind} ${symbol.name}`)
  ].join("\n");

  return {
    engine,
    text,
    rankedText: buildRankedText(topFiles, limitedSymbols),
    topFiles,
    topSymbols: limitedSymbols
  };
}
