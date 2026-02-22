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
  const modelCandidates = Array.from(new Set([preferredModel, 'gemini-2.5-pro']));
  const content = await readInput(inputPath);

  const prompt = [
    'Return JSON only with keys: vote, summary, evidenceRef.',
    'vote must be one of approve|reject|abstain.',
    'Assess this Salacia artifact for stage convergence.',
    content
  ].join('\n\n');

  let lastError = null;
  for (const model of modelCandidates) {
    try {
      const { stdout, stderr } = await execFileAsync('gemini', ['-p', prompt, '--model', model], {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 180_000
      });
      const raw = `${stdout}\n${stderr}`.trim();

      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = {
          vote: inferVote(raw),
          summary: raw.slice(0, 500),
          evidenceRef: inputPath ?? 'stdin'
        };
      }

      if (!['approve', 'reject', 'abstain'].includes(payload.vote)) {
        payload.vote = inferVote(JSON.stringify(payload));
      }

      if (!payload.summary) payload.summary = 'Gemini response parsed';
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
