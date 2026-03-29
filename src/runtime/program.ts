import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Blueprint, ProgramBudget } from "../core/types.js";
import { ensureSalaciaDirs, getSalaciaPaths } from "../core/paths.js";

const REQUIRED_SECTIONS = [
  "goal",
  "constraints",
  "mutable surface",
  "protected surface",
  "success metrics",
  "budget",
  "verification",
  "promotion policy"
] as const;

const DEFAULT_BUDGET: ProgramBudget = {
  maxFiles: 8,
  maxSymbols: 20,
  maxSnippetChars: 12_000,
  maxHistoryEntries: 5
};

function normalizeHeading(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseSectionList(lines: string[]): string[] {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*+]\s+/, "").trim())
    .filter(Boolean);
}

function parseBudget(lines: string[]): ProgramBudget {
  const budget = { ...DEFAULT_BUDGET };
  for (const line of lines) {
    const trimmed = line.trim().replace(/^[-*+]\s+/, "");
    const match = trimmed.match(/^([a-zA-Z][a-zA-Z0-9 _-]*):\s*(\d+)$/);
    if (!match) continue;
    const rawKey = match[1] ?? "";
    const rawValue = match[2] ?? "";
    const key = rawKey.trim().toLowerCase().replace(/[\s_-]+/g, "");
    const value = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (key === "maxfiles") budget.maxFiles = value;
    if (key === "maxsymbols") budget.maxSymbols = value;
    if (key === "maxsnippetchars") budget.maxSnippetChars = value;
    if (key === "maxhistoryentries") budget.maxHistoryEntries = value;
  }
  return budget;
}

function normalizePatterns(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function parseProgramSections(raw: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current: string | null = null;

  for (const line of raw.split(/\r?\n/g)) {
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      current = normalizeHeading(heading[1] ?? "");
      if (!sections.has(current)) {
        sections.set(current, []);
      }
      continue;
    }
    if (!current) continue;
    const bucket = sections.get(current) ?? [];
    bucket.push(line);
    sections.set(current, bucket);
  }

  return sections;
}

export function validateProgramMarkdown(raw: string): { ok: boolean; errors: string[] } {
  const sections = parseProgramSections(raw);
  const errors: string[] = [];

  for (const section of REQUIRED_SECTIONS) {
    const lines = sections.get(section);
    if (!lines || parseSectionList(lines).length === 0) {
      errors.push(`Missing required section: ${section}`);
    }
  }

  const mutable = normalizePatterns(parseSectionList(sections.get("mutable surface") ?? []));
  const protectedSurface = normalizePatterns(parseSectionList(sections.get("protected surface") ?? []));
  const overlap = mutable.filter((item) => protectedSurface.includes(item));
  if (overlap.length > 0) {
    errors.push(`Mutable/Protected surface overlap: ${overlap.join(", ")}`);
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

export async function compileProgramMarkdown(programPath: string): Promise<Blueprint> {
  const raw = await fs.readFile(programPath, "utf8");
  const validation = validateProgramMarkdown(raw);
  if (!validation.ok) {
    throw new Error(validation.errors.join("; "));
  }

  const sections = parseProgramSections(raw);
  const goalLines = parseSectionList(sections.get("goal") ?? []);
  const constraints = parseSectionList(sections.get("constraints") ?? []);
  const mutableSurface = normalizePatterns(parseSectionList(sections.get("mutable surface") ?? []));
  const protectedSurface = normalizePatterns(parseSectionList(sections.get("protected surface") ?? []));
  const successMetrics = parseSectionList(sections.get("success metrics") ?? []);
  const verificationCommands = parseSectionList(sections.get("verification") ?? []);
  const promotionPolicy = parseSectionList(sections.get("promotion policy") ?? []);
  const budget = parseBudget(sections.get("budget") ?? []);

  const id = createHash("sha256")
    .update(JSON.stringify({
      programPath: path.basename(programPath),
      goalLines,
      constraints,
      mutableSurface,
      protectedSurface,
      successMetrics,
      budget,
      verificationCommands,
      promotionPolicy
    }))
    .digest("hex")
    .slice(0, 16);

  return {
    id: `blueprint-${id}`,
    version: "v2",
    generatedAt: new Date().toISOString(),
    programPath,
    goal: goalLines.join(" ").trim(),
    constraints,
    mutableSurface,
    protectedSurface,
    successMetrics,
    budget,
    verificationCommands,
    promotionPolicy
  };
}

export async function saveBlueprint(root: string, blueprint: Blueprint): Promise<string> {
  const paths = await ensureSalaciaDirs(root);
  await fs.writeFile(paths.blueprint, JSON.stringify(blueprint, null, 2), "utf8");
  return paths.blueprint;
}

export async function loadBlueprint(root = process.cwd()): Promise<Blueprint | null> {
  const filePath = getSalaciaPaths(root).blueprint;
  const raw = await fs.readFile(filePath, "utf8").catch(() => "");
  if (!raw) return null;
  return JSON.parse(raw) as Blueprint;
}

export function defaultProgramPath(root = process.cwd()): string {
  return path.join(root, "program.md");
}
