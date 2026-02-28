import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { IntentIR } from "../core/types.js";
import { resolveUserCliCommand } from "../core/client-endpoints.js";

const execFileAsync = promisify(execFile);

export interface IntentSublimationPatch {
  goals?: string[];
  constraints?: string[];
  nonGoals?: string[];
  assumptions?: string[];
  acceptanceCriteria?: string[];
  affectedAreas?: string[];
  riskTags?: string[];
}

export interface LlmSublimationResult {
  applied: boolean;
  provider?: "claude" | "gemini" | "chatgpt";
  patch?: IntentSublimationPatch;
  reason?: string;
}

function normalizeList(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter((value) => value.length > 0)
    )
  );
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return normalizeList(value.map((item) => String(item ?? "")));
}

function extractJsonObject(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function parsePatch(raw: string): IntentSublimationPatch | null {
  const parsed = extractJsonObject(raw) as Record<string, unknown> | null;
  if (!parsed) return null;

  const patch: IntentSublimationPatch = {
    goals: parseStringArray(parsed.goals),
    constraints: parseStringArray(parsed.constraints),
    nonGoals: parseStringArray(parsed.nonGoals),
    assumptions: parseStringArray(parsed.assumptions),
    acceptanceCriteria: parseStringArray(parsed.acceptanceCriteria),
    affectedAreas: parseStringArray(parsed.affectedAreas),
    riskTags: parseStringArray(parsed.riskTags)
  };

  const hasSignal = Object.values(patch).some((items) => Array.isArray(items) && items.length > 0);
  return hasSignal ? patch : null;
}

function shouldUseLlmSublimation(): boolean {
  const mode = (process.env.SALACIA_PROMPT_LLM ?? "auto").toLowerCase();
  if (mode === "off" || mode === "false" || mode === "0") return false;
  if (mode === "on" || mode === "true" || mode === "1") return true;
  if (process.env.CI) return false;
  if (process.env.VITEST) return false;
  if (process.env.NODE_ENV === "test") return false;
  return true;
}

function buildPrompt(input: string, current: IntentIR): string {
  return [
    "You are Salacia Prompt Sublimator.",
    "Rewrite the user's vibe into a strict engineering intent schema.",
    "Support both Chinese and English input naturally.",
    "Return JSON only with keys:",
    "goals, constraints, nonGoals, assumptions, acceptanceCriteria, affectedAreas, riskTags",
    "Each key must be an array of short strings.",
    "",
    "User input:",
    input,
    "",
    "Current intent draft:",
    JSON.stringify(
      {
        goals: current.goals,
        constraints: current.constraints,
        nonGoals: current.nonGoals,
        assumptions: current.assumptions,
        acceptanceCriteria: current.acceptanceCriteria,
        affectedAreas: current.affectedAreas,
        riskTags: current.riskTags
      },
      null,
      2
    )
  ].join("\n");
}

async function runClaude(prompt: string, cwd: string): Promise<string | null> {
  const claudeCommand = await resolveUserCliCommand("claude");
  if (!claudeCommand) return null;

  const env = { ...process.env };
  const token = (process.env.ANTHROPIC_AUTH_TOKEN ?? "").trim();
  const baseUrl = (process.env.ANTHROPIC_BASE_URL ?? "").trim();
  if (token) env.ANTHROPIC_AUTH_TOKEN = token;
  if (baseUrl) env.ANTHROPIC_BASE_URL = baseUrl;

  const { stdout, stderr } = await execFileAsync(
    claudeCommand,
    ["-p", "--model", process.env.CLAUDE_MODEL ?? "claude-opus-4-6", prompt],
    {
      cwd,
      env,
      timeout: 90_000,
      maxBuffer: 10 * 1024 * 1024
    }
  );

  return `${stdout}\n${stderr}`.trim();
}

async function runGemini(prompt: string, cwd: string): Promise<string | null> {
  const geminiCommand = await resolveUserCliCommand("gemini");
  const npxCommand = geminiCommand ? null : await resolveUserCliCommand("npx");
  if (!geminiCommand && !npxCommand) return null;
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-pro";
  const command = geminiCommand ?? npxCommand!;
  const args = geminiCommand
    ? ["-p", prompt, "--model", model]
    : ["--yes", "@google/gemini-cli", "-p", prompt, "--model", model];
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd,
    timeout: 90_000,
    maxBuffer: 10 * 1024 * 1024
  });
  return `${stdout}\n${stderr}`.trim();
}

async function runChatGpt(prompt: string, cwd: string): Promise<string | null> {
  const chatgptCommand = await resolveUserCliCommand("chatgpt");
  if (chatgptCommand) {
    for (const args of [
      ["-p", prompt],
      ["prompt", prompt],
      ["run", prompt]
    ]) {
      try {
        const { stdout, stderr } = await execFileAsync(chatgptCommand, args, {
          cwd,
          timeout: 120_000,
          maxBuffer: 10 * 1024 * 1024
        });
        const text = `${stdout}\n${stderr}`.trim();
        if (text) return text;
      } catch {
        continue;
      }
    }
  }

  const codexCommand = await resolveUserCliCommand("codex");
  if (!codexCommand) {
    return null;
  }

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const schemaPath = path.join(os.tmpdir(), `salacia-sublimator-schema-${stamp}.json`);
  const outputPath = path.join(os.tmpdir(), `salacia-sublimator-output-${stamp}.json`);
  const schema = {
    type: "object",
    required: ["goals", "constraints", "nonGoals", "assumptions", "acceptanceCriteria", "affectedAreas", "riskTags"],
    additionalProperties: false,
    properties: {
      goals: { type: "array", items: { type: "string" } },
      constraints: { type: "array", items: { type: "string" } },
      nonGoals: { type: "array", items: { type: "string" } },
      assumptions: { type: "array", items: { type: "string" } },
      acceptanceCriteria: { type: "array", items: { type: "string" } },
      affectedAreas: { type: "array", items: { type: "string" } },
      riskTags: { type: "array", items: { type: "string" } }
    }
  };

  try {
    await fs.writeFile(schemaPath, JSON.stringify(schema, null, 2), "utf8");
    await execFileAsync(
      codexCommand,
      [
        "exec",
        "--ephemeral",
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        "--output-schema",
        schemaPath,
        "--output-last-message",
        outputPath,
        prompt
      ],
      {
        cwd,
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024
      }
    );
    return await fs.readFile(outputPath, "utf8").catch(() => null);
  } catch {
    return null;
  } finally {
    await fs.rm(schemaPath, { force: true }).catch(() => undefined);
    await fs.rm(outputPath, { force: true }).catch(() => undefined);
  }
}

function resolveProviders(): Array<"claude" | "gemini" | "chatgpt"> {
  const preferred = (process.env.SALACIA_PROMPT_LLM_PROVIDER ?? "auto").toLowerCase();
  if (preferred === "claude") return ["claude"];
  if (preferred === "gemini") return ["gemini"];
  if (preferred === "chatgpt") return ["chatgpt"];
  return ["claude", "gemini", "chatgpt"];
}

export async function sublimateWithUserLlm(input: string, current: IntentIR, cwd: string): Promise<LlmSublimationResult> {
  if (!shouldUseLlmSublimation()) {
    return { applied: false, reason: "llm-sublimation-disabled" };
  }

  const prompt = buildPrompt(input, current);
  const providers = resolveProviders();

  for (const provider of providers) {
    try {
      const raw =
        provider === "claude"
          ? await runClaude(prompt, cwd)
          : provider === "gemini"
            ? await runGemini(prompt, cwd)
            : await runChatGpt(prompt, cwd);
      if (!raw) {
        continue;
      }
      const patch = parsePatch(raw);
      if (!patch) {
        continue;
      }
      return {
        applied: true,
        provider,
        patch
      };
    } catch {
      continue;
    }
  }

  return { applied: false, reason: "llm-sublimation-unavailable" };
}
