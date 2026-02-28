#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function parseArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function latestRunId(cwd) {
  const root = path.join(cwd, ".salacia", "journal", "bench", "runs");
  const entries = await fs.readdir(root).catch(() => []);
  if (entries.length === 0) return null;

  const scored = await Promise.all(
    entries.map(async (id) => {
      const reportPath = path.join(root, id, "report.json");
      const stat = await fs.stat(reportPath).catch(() => null);
      return stat ? { id, mtimeMs: stat.mtimeMs } : null;
    })
  );
  const filtered = scored.filter((item) => item !== null);
  filtered.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return filtered[0]?.id ?? null;
}

async function main() {
  const cwd = process.cwd();
  const runId = parseArg("--run") ?? (await latestRunId(cwd));
  if (!runId) {
    console.error("No benchmark run found. Run `salacia benchmark run` first.");
    process.exit(1);
  }

  const { stdout, stderr } = await execFileAsync(
    "node",
    ["dist/cli/index.js", "benchmark", "verify", "--run", runId, "--json"],
    {
      cwd,
      maxBuffer: 10 * 1024 * 1024
    }
  ).catch((error) => {
    const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}\n${error.message ?? ""}`.trim();
    console.error(output);
    process.exit(1);
  });

  const output = `${stdout}\n${stderr}`.trim();
  if (output) {
    console.log(output);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
