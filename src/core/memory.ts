import fs from "node:fs/promises";
import path from "node:path";
import { getSalaciaPaths } from "./paths.js";

export interface ProgressEntry {
  sessionId: string;
  startedAt: string;
  finishedAt?: string;
  vibe: string;
  adapter: string;
  status: "running" | "pass" | "fail" | "rollback";
  stepsCompleted: number;
  stepsTotal: number;
  lastOutput?: string;
}

export interface ProgressState {
  current: ProgressEntry | null;
  history: ProgressEntry[];
}

function progressDir(root: string): string {
  return path.join(getSalaciaPaths(root).salacia, "progress");
}

function progressFilePath(root: string): string {
  return path.join(progressDir(root), "state.json");
}

export async function loadProgress(root: string): Promise<ProgressState> {
  const filePath = progressFilePath(root);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as ProgressState;
  } catch {
    return { current: null, history: [] };
  }
}

export async function saveProgress(root: string, state: ProgressState): Promise<string> {
  const dir = progressDir(root);
  await fs.mkdir(dir, { recursive: true });
  const filePath = progressFilePath(root);
  await fs.writeFile(filePath, JSON.stringify(state, null, 2), "utf8");
  return filePath;
}

export async function startSession(
  root: string,
  vibe: string,
  adapter: string,
  stepsTotal: number
): Promise<ProgressEntry> {
  const state = await loadProgress(root);
  const entry: ProgressEntry = {
    sessionId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: new Date().toISOString(),
    vibe,
    adapter,
    status: "running",
    stepsCompleted: 0,
    stepsTotal
  };
  state.current = entry;
  await saveProgress(root, state);
  return entry;
}

export async function updateSession(
  root: string,
  updates: Partial<Pick<ProgressEntry, "status" | "stepsCompleted" | "lastOutput" | "finishedAt">>
): Promise<void> {
  const state = await loadProgress(root);
  if (!state.current) return;

  if (updates.status !== undefined) state.current.status = updates.status;
  if (updates.stepsCompleted !== undefined) state.current.stepsCompleted = updates.stepsCompleted;
  if (updates.lastOutput !== undefined) state.current.lastOutput = updates.lastOutput?.slice(0, 500);
  if (updates.finishedAt !== undefined) state.current.finishedAt = updates.finishedAt;

  await saveProgress(root, state);
}

export async function finishSession(root: string, status: "pass" | "fail" | "rollback"): Promise<void> {
  const state = await loadProgress(root);
  if (!state.current) return;

  state.current.status = status;
  state.current.finishedAt = new Date().toISOString();
  state.history.push(state.current);
  if (state.history.length > 50) {
    state.history = state.history.slice(-50);
  }
  state.current = null;
  await saveProgress(root, state);
}

// ── CLAUDE.md / AGENTS.md Generation ────────────────────────────────

export interface ProjectMemoryContext {
  projectType: string;
  testCommands: string[];
  lintCommands: string[];
  buildCommands: string[];
  protectedPaths: string[];
}

export function generateClaudeMd(context: ProjectMemoryContext): string {
  const lines: string[] = [
    "# Project Context for AI Agents",
    "",
    "## Build & Test"
  ];

  if (context.buildCommands.length > 0) {
    for (const cmd of context.buildCommands) {
      lines.push(`- Build: \`${cmd}\``);
    }
  }
  if (context.testCommands.length > 0) {
    for (const cmd of context.testCommands) {
      lines.push(`- Test: \`${cmd}\``);
    }
  }
  if (context.lintCommands.length > 0) {
    for (const cmd of context.lintCommands) {
      lines.push(`- Lint: \`${cmd}\``);
    }
  }

  lines.push("", "## Coding Conventions");
  lines.push(`- Language: ${context.projectType}`);
  lines.push("- Follow existing patterns in the codebase");
  lines.push("- Write tests for new features");

  if (context.protectedPaths.length > 0) {
    lines.push("", "## Protected Paths (Do NOT modify)");
    for (const p of context.protectedPaths) {
      lines.push(`- ${p}`);
    }
  }

  lines.push("", "## Workflow");
  lines.push("1. Read and understand the relevant code");
  lines.push("2. Plan changes before implementing");
  lines.push("3. Make incremental changes");
  lines.push("4. Run tests after each change");
  lines.push("5. Commit with descriptive messages");
  lines.push("");

  return lines.join("\n");
}

export function generateAgentsMd(context: ProjectMemoryContext): string {
  const lines: string[] = [
    "# Agent Instructions",
    "",
    "## Workflow",
    "Explore → Plan → Code → Test → Commit (incremental, small changes)",
    "",
    "## Rules",
    "- Run tests after each change"
  ];

  if (context.testCommands.length > 0) {
    lines.push(`- Test command: \`${context.testCommands[0]}\``);
  }
  lines.push("- Create atomic git commits with descriptive messages");
  lines.push("- Update progress notes after each session");

  if (context.protectedPaths.length > 0) {
    lines.push("", "## Protected Paths");
    for (const p of context.protectedPaths) {
      lines.push(`- Do NOT modify: \`${p}\``);
    }
  }

  lines.push("");
  return lines.join("\n");
}

export async function writeMemoryFiles(
  root: string,
  context: ProjectMemoryContext
): Promise<{ claudeMdPath: string; agentsMdPath: string }> {
  const salaciaDir = getSalaciaPaths(root).salacia;
  await fs.mkdir(salaciaDir, { recursive: true });

  const claudeMdPath = path.join(salaciaDir, "CLAUDE.md");
  const agentsMdPath = path.join(salaciaDir, "AGENTS.md");

  await fs.writeFile(claudeMdPath, generateClaudeMd(context), "utf8");
  await fs.writeFile(agentsMdPath, generateAgentsMd(context), "utf8");

  return { claudeMdPath, agentsMdPath };
}
