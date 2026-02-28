#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function inferVote(text) {
  const normalized = text.toLowerCase();
  if (normalized.includes('reject') || normalized.includes('fail') || normalized.includes('error')) return 'reject';
  if (normalized.includes('abstain') || normalized.includes('unknown') || normalized.includes('uncertain')) return 'abstain';
  return 'approve';
}

function normalizeVote(value) {
  const lower = String(value ?? '').toLowerCase().trim();
  if (lower === 'approve' || lower === 'reject' || lower === 'abstain') return lower;
  return null;
}

function parsePayload(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const candidates = [trimmed];
  const objectMatches = trimmed.match(/\{[\s\S]*?\}/g);
  if (Array.isArray(objectMatches)) {
    candidates.push(...objectMatches);
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const vote = normalizeVote(parsed?.vote);
      if (!vote) continue;
      return {
        vote,
        summary: String(parsed?.summary ?? 'Claude response parsed').slice(0, 500),
        evidenceRef: String(parsed?.evidenceRef ?? '').trim()
      };
    } catch {
      continue;
    }
  }

  return null;
}

async function fileExists(filePath) {
  if (!String(filePath ?? '').trim()) return false;
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveCommand(command) {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('where', [command], { timeout: 10_000, maxBuffer: 1024 * 1024 });
      const first = String(stdout)
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .find(Boolean);
      return first ?? null;
    }

    const { stdout } = await execFileAsync('which', [command], { timeout: 10_000, maxBuffer: 1024 * 1024 });
    const first = String(stdout)
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .find(Boolean);
    return first ?? null;
  } catch {
    return null;
  }
}

async function resolveClaudeDesktopPath() {
  const binaryName = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const roots = [path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude-code')];
  if (String(process.env.LOCALAPPDATA ?? '').trim()) {
    roots.push(path.join(process.env.LOCALAPPDATA, 'Claude', 'claude-code'));
  }
  roots.push(path.join(os.homedir(), '.local', 'share', 'Claude', 'claude-code'));

  const directCandidates = [];
  for (const root of roots) {
    directCandidates.push(path.join(root, 'current', binaryName));
    directCandidates.push(path.join(root, 'latest', binaryName));
    directCandidates.push(path.join(root, binaryName));
  }

  for (const candidate of directCandidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  for (const root of roots) {
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    const candidates = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        filePath: path.join(root, entry.name, binaryName)
      }));

    candidates.sort((a, b) => collator.compare(b.name, a.name));
    for (const candidate of candidates) {
      if (await fileExists(candidate.filePath)) {
        return candidate.filePath;
      }
    }
  }

  return null;
}

async function resolveClaudeCommand() {
  const envOverride = String(process.env.SALACIA_CLAUDE_BIN ?? '').trim();
  if (envOverride && (await fileExists(envOverride))) {
    return envOverride;
  }

  return (await resolveCommand('claude')) ?? (await resolveClaudeDesktopPath());
}

async function readInput(filePath) {
  if (filePath) {
    return fs.readFile(filePath, 'utf8');
  }

  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const inputPath = process.argv[2];
  const model = process.env.CLAUDE_MODEL ?? 'claude-opus-4-6';
  const claudeCommand = await resolveClaudeCommand();

  const content = await readInput(inputPath);
  const prompt = [
    'Return JSON only with keys: vote, summary, evidenceRef.',
    'vote must be one of approve|reject|abstain.',
    'Assess this Salacia artifact for stage convergence.',
    content
  ].join('\n\n');

  const env = { ...process.env };

  if (!claudeCommand) {
    console.log(
      JSON.stringify({
        vote: 'abstain',
        summary: 'Claude CLI not found on user endpoint',
        evidenceRef: inputPath ?? 'stdin'
      })
    );
    process.exit(1);
  }

  try {
    const { stdout, stderr } = await execFileAsync(claudeCommand, ['-p', '--model', model, prompt], {
      env,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 180_000
    });
    const raw = `${stdout}\n${stderr}`.trim();

    const parsed = parsePayload(raw);
    const payload = parsed ?? {
      vote: inferVote(raw),
      summary: raw.slice(0, 500),
      evidenceRef: inputPath ?? 'stdin'
    };

    if (!payload.evidenceRef) payload.evidenceRef = inputPath ?? 'stdin';
    console.log(JSON.stringify(payload));
  } catch (error) {
    console.log(
      JSON.stringify({
        vote: 'abstain',
        summary: `Claude execution failed: ${error.message}`,
        evidenceRef: inputPath ?? 'stdin'
      })
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.log(
    JSON.stringify({
      vote: 'abstain',
      summary: `Claude validator crashed: ${error.message}`,
      evidenceRef: process.argv[2] ?? 'stdin'
    })
  );
  process.exit(1);
});
