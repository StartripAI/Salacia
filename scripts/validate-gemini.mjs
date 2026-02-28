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
        summary: String(parsed?.summary ?? 'Gemini response parsed').slice(0, 500),
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

async function resolveGeminiInvocation() {
  const geminiCommand = await resolveCommand('gemini');
  if (geminiCommand) {
    return { command: geminiCommand, argsPrefix: [] };
  }

  const npxCommand = await resolveCommand('npx');
  if (npxCommand) {
    return { command: npxCommand, argsPrefix: ['--yes', '@google/gemini-cli'] };
  }

  return null;
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

async function main() {
  const inputPath = process.argv[2];
  const preferredModel = process.env.GEMINI_MODEL ?? 'gemini-3.1-pro';
  const modelCandidates = Array.from(new Set([preferredModel, 'gemini-3.0-pro']));
  const content = await readInput(inputPath);
  const invocation = await resolveGeminiInvocation();

  if (!invocation) {
    console.log(
      JSON.stringify({
        vote: 'abstain',
        summary: 'Gemini CLI unavailable on user endpoint (gemini command or npx chain required)',
        evidenceRef: inputPath ?? 'stdin'
      })
    );
    process.exit(1);
  }

  const prompt = [
    'Return JSON only with keys: vote, summary, evidenceRef.',
    'vote must be one of approve|reject|abstain.',
    'Assess this Salacia artifact for stage convergence.',
    content
  ].join('\n\n');

  let lastError = null;
  for (const model of modelCandidates) {
    try {
      const { stdout, stderr } = await execFileAsync(
        invocation.command,
        [...invocation.argsPrefix, '-p', prompt, '--model', model],
        {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 180_000
        }
      );
      const raw = `${stdout}\n${stderr}`.trim();

      const parsed = parsePayload(raw);
      const payload = parsed ?? {
        vote: inferVote(raw),
        summary: raw.slice(0, 500),
        evidenceRef: inputPath ?? 'stdin'
      };

      if (!payload.evidenceRef) payload.evidenceRef = inputPath ?? 'stdin';
      payload.summary = `[model=${model}] ${payload.summary}`;
      console.log(JSON.stringify(payload));
      return;
    } catch (error) {
      lastError = error;
      const message = `${error.message ?? ''}`;
      const modelNotFound = message.includes('ModelNotFoundError') || message.includes('404');
      if (!modelNotFound) {
        break;
      }
    }
  }

  console.log(
    JSON.stringify({
      vote: 'abstain',
      summary: `Gemini execution failed: ${lastError?.message ?? 'unknown error'}`,
      evidenceRef: inputPath ?? 'stdin'
    })
  );
  process.exit(1);
}

main().catch((error) => {
  console.log(
    JSON.stringify({
      vote: 'abstain',
      summary: `Gemini validator crashed: ${error.message}`,
      evidenceRef: process.argv[2] ?? 'stdin'
    })
  );
  process.exit(1);
});
