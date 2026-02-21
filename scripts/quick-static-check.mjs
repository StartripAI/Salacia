#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function run(cmd, args) {
  const { stdout, stderr } = await execFileAsync(cmd, args, { maxBuffer: 10 * 1024 * 1024 });
  process.stdout.write(stdout);
  process.stderr.write(stderr);
}

async function main() {
  await run('npm', ['run', 'typecheck']);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
