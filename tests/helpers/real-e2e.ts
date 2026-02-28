import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  commandExists as commandExistsOnClient,
  resolveUserCliCommand
} from "../../src/core/client-endpoints.js";

const execFileAsync = promisify(execFile);

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function hasGeminiEndpoint(): Promise<boolean> {
  if (await commandExistsOnClient("gemini")) {
    return true;
  }
  const npxCommand = await resolveUserCliCommand("npx");
  if (!npxCommand) return false;
  try {
    await execFileAsync(npxCommand, ["--yes", "@google/gemini-cli", "--help"], {
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024
    });
    return true;
  } catch {
    return false;
  }
}

export async function ensureRealLlmEnvironment(): Promise<void> {
  const hasClaude = await commandExistsOnClient("claude");
  const hasGemini = await hasGeminiEndpoint();
  const hasChatgpt = await commandExistsOnClient("chatgpt");
  const hasCodex = await commandExistsOnClient("codex");
  const hasAnyExternal = hasClaude || hasGemini || hasChatgpt || hasCodex;

  if (!hasAnyExternal) {
    throw new Error(
      "Real LLM E2E prerequisites missing. Need at least one user-endpoint model CLI chain: claude|gemini|chatgpt|codex (gemini can run via npx)."
    );
  }
}

export async function copyRealAdvisorScripts(repoRoot: string, targetRoot: string): Promise<void> {
  const sourceDir = path.join(repoRoot, "scripts");
  const targetDir = path.join(targetRoot, "scripts");
  await fs.mkdir(targetDir, { recursive: true });

  for (const file of ["validate-claude.mjs", "validate-gemini.mjs", "validate-chatgpt.mjs"]) {
    await fs.copyFile(path.join(sourceDir, file), path.join(targetDir, file));
  }
}

export function parseJsonOutput(raw: string): unknown {
  return JSON.parse(raw.trim());
}

export async function runCli(cliPath: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [cliPath, ...args], {
      cwd,
      env: env ?? process.env,
      maxBuffer: 16 * 1024 * 1024
    });
    return {
      code: 0,
      stdout: String(stdout),
      stderr: String(stderr)
    };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof e.code === "number" ? e.code : 1,
      stdout: String(e.stdout ?? ""),
      stderr: String(e.stderr ?? "")
    };
  }
}
