#!/usr/bin/env node
import fs from "node:fs/promises";
import { basename } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const FALLBACK_PATTERNS = [
  { kind: "function", regex: /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)/ },
  { kind: "class", regex: /^(?:export\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)/ },
  { kind: "method", regex: /^(?:async\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/ },
  { kind: "function", regex: /^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/ },
  { kind: "class", regex: /^class\s+([A-Za-z_][A-Za-z0-9_]*)/ },
  { kind: "function", regex: /^func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/ },
  { kind: "function", regex: /^pub\s+fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/ }
];

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function toSymbolId(filePath, name, line, index) {
  return `${filePath}::${name}:${line}:${index}`;
}

async function hasTreeSitterCli() {
  try {
    await execFileAsync("tree-sitter", ["--version"], { timeout: 5_000, maxBuffer: 1024 * 1024 });
    return true;
  } catch {
    return false;
  }
}

function parseLineCol(part) {
  const match = String(part || "").match(/^(\d+)(?:[:.,](\d+))?$/);
  if (!match) {
    return null;
  }
  return {
    line: Number.parseInt(match[1], 10),
    column: Number.parseInt(match[2] || "1", 10)
  };
}

function parseTreeSitterTags(raw, filePath, maxSymbolsPerFile) {
  const symbols = [];
  const lines = String(raw || "").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split("\t").map((item) => item.trim()).filter(Boolean);
    if (parts.length === 0) continue;

    const name = parts[0] || "symbol";
    const maybeLineCol = parts.map(parseLineCol).find(Boolean) || { line: 1, column: 1 };
    const kind =
      parts
        .find((part) => /^(function|method|class|interface|enum|variable|const|type|module)$/i.test(part))
        ?.toLowerCase() || "symbol";

    symbols.push({
      filePath,
      name,
      kind,
      line: maybeLineCol.line,
      column: maybeLineCol.column,
      source: "tree-sitter"
    });

    if (symbols.length >= maxSymbolsPerFile) break;
  }

  return symbols;
}

async function extractSymbolsWithTreeSitter(filePath, maxSymbolsPerFile) {
  try {
    const { stdout } = await execFileAsync(
      "tree-sitter",
      ["tags", filePath],
      { timeout: 20_000, maxBuffer: 8 * 1024 * 1024 }
    );
    return parseTreeSitterTags(stdout, filePath, maxSymbolsPerFile);
  } catch {
    return [];
  }
}

async function extractSymbolsFallback(filePath, maxSymbolsPerFile) {
  let content = "";
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch {
    return [];
  }

  const symbols = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;

    for (const pattern of FALLBACK_PATTERNS) {
      const match = line.match(pattern.regex);
      if (!match) continue;
      symbols.push({
        filePath,
        name: match[1],
        kind: pattern.kind,
        line: index + 1,
        column: 1,
        source: "fallback-regex"
      });
      break;
    }

    if (symbols.length >= maxSymbolsPerFile) break;
  }

  return symbols;
}

function buildFileTokenSet(fileEntry) {
  const queryTokens = [];
  const sampleLines = Array.isArray(fileEntry?.sampleLines) ? fileEntry.sampleLines : [];
  for (const sample of sampleLines) {
    queryTokens.push(...tokenize(sample.query));
    queryTokens.push(...tokenize(sample.preview));
  }
  queryTokens.push(...tokenize(basename(fileEntry.path || "")));
  return [...new Set(queryTokens)].slice(0, 32);
}

function normalizeFaultScores(fileEntries) {
  const maxScore = Math.max(1, ...fileEntries.map((file) => Number(file.score) || 0));
  const out = new Map();
  for (const file of fileEntries) {
    out.set(file.path, clamp((Number(file.score) || 0) / maxScore));
  }
  return out;
}

function buildSegmentsBySymbol(filesByPath, symbolsByFile) {
  const segmentBySymbol = new Map();

  for (const [filePath, symbols] of symbolsByFile.entries()) {
    const file = filesByPath.get(filePath);
    const lines = file?.lines || [];
    const sorted = [...symbols].sort((a, b) => a.line - b.line || a.name.localeCompare(b.name));

    for (let i = 0; i < sorted.length; i += 1) {
      const symbol = sorted[i];
      const next = sorted[i + 1];
      const start = Math.max(1, symbol.line);
      const end = Math.max(start, Math.min(lines.length, (next?.line || lines.length + 1) - 1));
      const segment = lines.slice(start - 1, end).join("\n").toLowerCase();
      segmentBySymbol.set(symbol.id, segment);
    }
  }

  return segmentBySymbol;
}

function buildGraph(symbols, symbolsByFile, filesByPath) {
  const segmentBySymbol = buildSegmentsBySymbol(filesByPath, symbolsByFile);
  const edgeMap = new Map();
  const nameIndex = symbols
    .filter((symbol) => symbol.name.length >= 3)
    .map((symbol) => ({
      ...symbol,
      nameLower: symbol.name.toLowerCase()
    }));

  for (const from of symbols) {
    const segment = segmentBySymbol.get(from.id) || "";
    if (!segment) continue;

    for (const target of nameIndex) {
      if (target.id === from.id) continue;
      const token = target.nameLower;
      if (!token || token.length < 3) continue;

      const re = new RegExp(`(^|[^a-z0-9_])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[^a-z0-9_]|$)`, "i");
      if (!re.test(segment)) continue;

      const sameFile = from.filePath === target.filePath;
      const edgeKey = `${from.id}->${target.id}`;
      const current = edgeMap.get(edgeKey) || {
        from: from.id,
        to: target.id,
        kind: sameFile ? "intra-file-ref" : "cross-file-ref",
        weight: 0
      };
      current.weight += sameFile ? 1 : 1.2;
      edgeMap.set(edgeKey, current);
    }
  }

  return [...edgeMap.values()];
}

function computeGraphScores(symbols, edges, iterations = 20, damping = 0.85) {
  if (symbols.length === 0) return new Map();

  const ids = symbols.map((symbol) => symbol.id);
  const index = new Map(ids.map((id, idx) => [id, idx]));
  const n = ids.length;

  const outWeight = new Array(n).fill(0);
  const incoming = Array.from({ length: n }, () => []);

  for (const edge of edges) {
    const from = index.get(edge.from);
    const to = index.get(edge.to);
    if (from == null || to == null) continue;
    const weight = Number(edge.weight) || 0;
    if (weight <= 0) continue;
    outWeight[from] += weight;
    incoming[to].push({ from, weight });
  }

  let scores = new Array(n).fill(1 / n);
  for (let iter = 0; iter < iterations; iter += 1) {
    const next = new Array(n).fill((1 - damping) / n);
    for (let to = 0; to < n; to += 1) {
      let sum = 0;
      for (const edge of incoming[to]) {
        if (outWeight[edge.from] === 0) continue;
        sum += scores[edge.from] * (edge.weight / outWeight[edge.from]);
      }
      next[to] += damping * sum;
    }
    scores = next;
  }

  const maxScore = Math.max(...scores, 1e-9);
  const out = new Map();
  for (let i = 0; i < n; i += 1) {
    out.set(ids[i], clamp(scores[i] / maxScore));
  }
  return out;
}

function roundScore(value) {
  return Number((value || 0).toFixed(6));
}

function buildRankedText(topFiles, topSymbols) {
  const lines = [
    "Ranking method: v1 (0.45 fault + 0.35 graph + 0.20 keyword proximity)",
    "",
    "Top files:"
  ];

  for (const file of topFiles) {
    lines.push(`- [rank=${file.rank.toFixed(4)} fault=${file.faultScore.toFixed(4)}] ${file.path}`);
  }

  lines.push("", "Top symbols:");
  for (const symbol of topSymbols) {
    lines.push(
      `- [rank=${symbol.rank.toFixed(4)} fault=${symbol.faultScore.toFixed(4)} graph=${symbol.graphScore.toFixed(4)} keyword=${symbol.keywordProximity.toFixed(4)}] ${symbol.filePath}:${symbol.line} ${symbol.kind} ${symbol.name}`
    );
  }

  return lines.join("\n");
}

export async function buildTreeSitterRepoMap(rankedFiles, options = {}) {
  const maxFiles = Number.isFinite(options.maxFiles) ? options.maxFiles : 8;
  const maxSymbolsPerFile = Number.isFinite(options.maxSymbolsPerFile) ? options.maxSymbolsPerFile : 10;
  const maxPromptFiles = Number.isFinite(options.maxPromptFiles) ? options.maxPromptFiles : 6;
  const maxPromptSymbols = Number.isFinite(options.maxPromptSymbols) ? options.maxPromptSymbols : 20;

  const candidateFiles = (Array.isArray(rankedFiles) ? rankedFiles : [])
    .filter((item) => item && typeof item.path === "string")
    .slice(0, maxFiles);

  const treeSitterAvailable = await hasTreeSitterCli();
  const engine = treeSitterAvailable ? "tree-sitter" : "fallback-regex";

  const filesByPath = new Map();
  for (const file of candidateFiles) {
    const content = await fs.readFile(file.path, "utf8").catch(() => "");
    filesByPath.set(file.path, {
      file,
      lines: content.split(/\r?\n/),
      keywordTokens: buildFileTokenSet(file)
    });
  }

  const symbols = [];
  const symbolsByFile = new Map();

  for (const file of candidateFiles) {
    const extracted = treeSitterAvailable
      ? await extractSymbolsWithTreeSitter(file.path, maxSymbolsPerFile)
      : await extractSymbolsFallback(file.path, maxSymbolsPerFile);

    const withIds = extracted.map((symbol, index) => ({
      ...symbol,
      id: toSymbolId(symbol.filePath, symbol.name, symbol.line, index)
    }));

    symbolsByFile.set(file.path, withIds);
    symbols.push(...withIds);
  }

  const edges = buildGraph(symbols, symbolsByFile, filesByPath);
  const graphScores = computeGraphScores(symbols, edges);
  const faultScores = normalizeFaultScores(candidateFiles);

  const symbolRows = symbols.map((symbol) => {
    const fileEntry = filesByPath.get(symbol.filePath);
    const lineText = fileEntry?.lines?.[Math.max(0, symbol.line - 1)] || "";
    const fileTokens = fileEntry?.keywordTokens || [];
    const keyMatchCount = fileTokens.filter((token) => {
      return symbol.name.toLowerCase().includes(token) || lineText.toLowerCase().includes(token);
    }).length;

    const keywordProximity = clamp(fileTokens.length > 0 ? keyMatchCount / Math.min(fileTokens.length, 6) : 0);
    const faultScore = faultScores.get(symbol.filePath) || 0;
    const graphScore = graphScores.get(symbol.id) || 0;
    const rank = 0.45 * faultScore + 0.35 * graphScore + 0.20 * keywordProximity;

    return {
      id: symbol.id,
      filePath: symbol.filePath,
      name: symbol.name,
      kind: symbol.kind,
      line: symbol.line,
      column: symbol.column,
      source: symbol.source,
      faultScore: roundScore(faultScore),
      graphScore: roundScore(graphScore),
      keywordProximity: roundScore(keywordProximity),
      rank: roundScore(rank)
    };
  });

  symbolRows.sort((a, b) => b.rank - a.rank || a.filePath.localeCompare(b.filePath) || a.line - b.line);

  const fileRows = candidateFiles.map((file) => {
    const fileSymbols = symbolRows.filter((symbol) => symbol.filePath === file.path);
    const topSymbolRank = fileSymbols.length > 0 ? fileSymbols[0].rank : 0;
    const faultScore = faultScores.get(file.path) || 0;
    const rank = 0.6 * topSymbolRank + 0.4 * faultScore;

    return {
      path: file.path,
      score: Number(file.score) || 0,
      hitCount: Number(file.hitCount) || 0,
      symbolCount: fileSymbols.length,
      faultScore: roundScore(faultScore),
      rank: roundScore(rank)
    };
  });

  fileRows.sort((a, b) => b.rank - a.rank || b.score - a.score || b.hitCount - a.hitCount);

  const topFiles = fileRows.slice(0, maxPromptFiles);
  const topSymbols = symbolRows.slice(0, maxPromptSymbols);
  const rankedText = buildRankedText(topFiles, topSymbols);

  return {
    engine,
    rankingMethod: "v1",
    nodes: symbolRows.length,
    edges: edges.length,
    files: fileRows,
    topFiles,
    topSymbols,
    graph: {
      nodes: symbolRows,
      edges: edges.map((edge) => ({
        from: edge.from,
        to: edge.to,
        kind: edge.kind,
        weight: roundScore(edge.weight)
      }))
    },
    text: rankedText,
    rankedText
  };
}
