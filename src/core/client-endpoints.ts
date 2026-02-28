import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function overrideEnvName(command: string): string {
  const normalized = command.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
  return `SALACIA_${normalized}_BIN`;
}

async function fileExists(filePath: string): Promise<boolean> {
  if (!filePath.trim()) return false;
  return fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}

async function resolveFromPath(command: string): Promise<string | null> {
  try {
    const tool = process.platform === "win32" ? "where" : "which";
    const { stdout } = await execFileAsync(tool, [command], {
      timeout: 8_000,
      maxBuffer: 1024 * 1024
    });
    const hit = stdout
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    return hit ?? null;
  } catch {
    return null;
  }
}

async function resolveClaudeDesktopBinary(): Promise<string | null> {
  const binaryName = process.platform === "win32" ? "claude.exe" : "claude";
  const roots = [path.join(os.homedir(), "Library", "Application Support", "Claude", "claude-code")];
  const localAppData = (process.env.LOCALAPPDATA ?? "").trim();
  if (localAppData) {
    roots.push(path.join(localAppData, "Claude", "claude-code"));
  }
  roots.push(path.join(os.homedir(), ".local", "share", "Claude", "claude-code"));

  const directCandidates: string[] = [];
  for (const root of roots) {
    directCandidates.push(path.join(root, "current", binaryName));
    directCandidates.push(path.join(root, "latest", binaryName));
    directCandidates.push(path.join(root, binaryName));
  }

  for (const candidate of directCandidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  for (const root of roots) {
    const dirs = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    const versionCandidates = dirs
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        filePath: path.join(root, entry.name, binaryName)
      }));

    versionCandidates.sort((a, b) => collator.compare(b.name, a.name));
    for (const candidate of versionCandidates) {
      if (await fileExists(candidate.filePath)) {
        return candidate.filePath;
      }
    }
  }

  return null;
}

export async function resolveUserCliCommand(command: string): Promise<string | null> {
  const override = (process.env[overrideEnvName(command)] ?? "").trim();
  if (override && (await fileExists(override))) {
    return override;
  }

  const direct = await resolveFromPath(command);
  if (direct) {
    return direct;
  }

  if (command === "claude") {
    return resolveClaudeDesktopBinary();
  }

  return null;
}

export async function commandExists(command: string): Promise<boolean> {
  return Boolean(await resolveUserCliCommand(command));
}
