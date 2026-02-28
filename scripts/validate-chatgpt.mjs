#!/usr/bin/env node
import fs from 'node:fs/promises';
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
        summary: String(parsed?.summary ?? 'ChatGPT response parsed').slice(0, 500),
        evidenceRef: String(parsed?.evidenceRef ?? '').trim()
      };
    } catch {
      continue;
    }
  }

  return null;
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
    } else {
      const { stdout } = await execFileAsync('which', [command], { timeout: 10_000, maxBuffer: 1024 * 1024 });
      const first = String(stdout)
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .find(Boolean);
      return first ?? null;
    }
  } catch {
    return null;
  }
}

async function readInput(filePath) {
  if (filePath) return fs.readFile(filePath, 'utf8');
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

async function runChatgpt(prompt) {
  const chatgptCommand = await resolveCommand('chatgpt');
  if (!chatgptCommand) return null;
  for (const args of [['-p', prompt], ['prompt', prompt], ['run', prompt]]) {
    try {
      const { stdout, stderr } = await execFileAsync(chatgptCommand, args, {
        timeout: 180_000,
        maxBuffer: 10 * 1024 * 1024
      });
      const text = `${stdout}\n${stderr}`.trim();
      if (text) return text;
    } catch {
      continue;
    }
  }
  return null;
}

async function runCodex(prompt) {
  const codexCommand = await resolveCommand('codex');
  if (!codexCommand) return null;
  try {
    const { stdout, stderr } = await execFileAsync(
      codexCommand,
      ['exec', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check', prompt],
      {
        timeout: 180_000,
        maxBuffer: 10 * 1024 * 1024
      }
    );
    const text = `${stdout}\n${stderr}`.trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

async function main() {
  const inputPath = process.argv[2];
  const content = await readInput(inputPath);

  const prompt = [
    'Return JSON only with keys: vote, summary, evidenceRef.',
    'vote must be one of approve|reject|abstain.',
    'Assess this Salacia artifact for stage convergence.',
    content
  ].join('\n\n');

  const raw = (await runChatgpt(prompt)) ?? (await runCodex(prompt));
  if (!raw) {
    console.log(
      JSON.stringify({
        vote: 'abstain',
        summary: 'No available chatgpt/codex CLI for advisor execution',
        evidenceRef: inputPath ?? 'stdin'
      })
    );
    process.exit(1);
  }

  const parsed = parsePayload(raw);
  const payload = parsed ?? {
    vote: inferVote(raw),
    summary: raw.slice(0, 500),
    evidenceRef: inputPath ?? 'stdin'
  };

  if (!payload.evidenceRef) payload.evidenceRef = inputPath ?? 'stdin';
  console.log(JSON.stringify(payload));
}

main().catch((error) => {
  console.log(
    JSON.stringify({
      vote: 'abstain',
      summary: `ChatGPT validator crashed: ${error.message}`,
      evidenceRef: process.argv[2] ?? 'stdin'
    })
  );
  process.exit(1);
});
