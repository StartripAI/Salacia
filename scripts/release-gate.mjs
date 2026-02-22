#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function run(cmd, args, opts = {}) {
  const { stdout, stderr } = await execFileAsync(cmd, args, {
    maxBuffer: 10 * 1024 * 1024,
    ...opts
  });
  return `${stdout}\n${stderr}`.trim();
}

async function runChecked(name, cmd, args, opts = {}) {
  try {
    const output = await run(cmd, args, opts);
    return { name, passed: true, output, details: output.slice(0, 1000) };
  } catch (error) {
    const e = error;
    const output = `${e.stdout ?? ''}\n${e.stderr ?? ''}\n${e.message}`.trim();
    return { name, passed: false, output, details: output.slice(0, 1000) };
  }
}

function extractFirstJsonObject(raw) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  const candidate = raw.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

async function runSecretScan(cwd) {
  return runChecked("secret-scan", "node", ["scripts/secret-scan.mjs"], { cwd });
}

async function runPromptMetamorphicCheck(cwd) {
  const compile = await runChecked(
    "prompt-compile",
    "node",
    ["dist/cli/index.js", "prompt", "compile", "stabilize release gate quality baseline", "--json"],
    { cwd }
  );
  if (!compile.passed) {
    return {
      name: "prompt-metamorphic-pass",
      passed: false,
      details: `Prompt compile failed: ${compile.details}`
    };
  }

  const compilePayload = extractFirstJsonObject(compile.output ?? compile.details ?? "");
  const intentPath = compilePayload?.intentPath;
  if (!intentPath || typeof intentPath !== "string") {
    return {
      name: "prompt-metamorphic-pass",
      passed: false,
      details: `Prompt compile did not return intentPath: ${compile.details}`
    };
  }

  const test = await runChecked(
    "prompt-test",
    "node",
    ["dist/cli/index.js", "prompt", "test", "--input", intentPath, "--json"],
    { cwd }
  );
  const testPayload = extractFirstJsonObject(test.output ?? test.details ?? "");
  const pass = test.passed && Boolean(testPayload?.ok);

  return {
    name: "prompt-metamorphic-pass",
    passed: pass,
    details: pass
      ? `Prompt metamorphic checks passed for ${intentPath}`
      : `Prompt metamorphic checks failed: ${test.details}`
  };
}

function parseArg(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

async function runConvergenceCheck(name, stage, inputPath, cwd, external) {
  const result = await runChecked(
    name,
    "node",
    ["dist/cli/index.js", "converge", "--stage", stage, "--input", inputPath, ...(external ? ["--external"] : []), "--json"],
    { cwd }
  );

  const decision = extractFirstJsonObject(result.output ?? result.details ?? "");
  if (!decision) {
    return {
      ...result,
      passed: false,
      details: `Malformed convergence JSON for ${name}: ${result.details}`
    };
  }

  const advisors = Array.isArray(decision.advisors) ? decision.advisors : [];
  const hasEvidence = advisors.every((advisor) => typeof advisor?.evidenceRef === "string" && advisor.evidenceRef.length > 0);
  const hasInvalid = advisors.some((advisor) => advisor?.parseStatus === "invalid");
  const unresolvedSplit = Boolean(decision.requiresHumanApproval) || decision.winner === "abstain";
  const pass = result.passed && advisors.length >= 3 && hasEvidence && !hasInvalid && !unresolvedSplit;

  return {
    ...result,
    passed: pass,
    details: pass
      ? JSON.stringify(decision)
      : `Convergence policy failed (${name}): advisors=${advisors.length}, hasEvidence=${hasEvidence}, hasInvalid=${hasInvalid}, unresolvedSplit=${unresolvedSplit}, raw=${result.details}`,
    decision
  };
}

async function main() {
  const cwd = process.cwd();
  const planPath = parseArg("--plan");
  const execPath = parseArg("--exec");
  const requireConvergence = hasFlag("--require-convergence");
  const externalAdvisors = !hasFlag("--no-external");

  const checks = [];
  checks.push(await runChecked("lint", "npm", ["run", "lint"], { cwd }));
  checks.push(await runChecked("test", "npm", ["test"], { cwd }));
  checks.push(await runChecked("build", "npm", ["run", "build"], { cwd }));
  checks.push(await runChecked("smoke", "npm", ["run", "smoke"], { cwd }));
  checks.push(await runSecretScan(cwd));
  checks.push(await runPromptMetamorphicCheck(cwd));
  checks.push(await runChecked("superiority-audit", "node", ["dist/cli/index.js", "audit", "superiority", "--json"], { cwd }));

  const convergence = {
    plan: null,
    exec: null
  };
  const convergeChecks = [];

  if (requireConvergence && (!planPath || !execPath)) {
    convergeChecks.push({
      name: "converge-inputs",
      passed: false,
      details: "Both --plan and --exec are required when --require-convergence is set"
    });
  }

  if (planPath) {
    const planCheck = await runConvergenceCheck("converge-plan", "plan", planPath, cwd, externalAdvisors);
    convergence.plan = planCheck.decision ?? null;
    convergeChecks.push(planCheck);
  }

  if (execPath) {
    const execCheck = await runConvergenceCheck("converge-exec", "exec", execPath, cwd, externalAdvisors);
    convergence.exec = execCheck.decision ?? null;
    convergeChecks.push(execCheck);
  }

  checks.push(...convergeChecks);

  const allPassed = checks.every((c) => c.passed);
  const report = {
    generatedAt: new Date().toISOString(),
    checks,
    convergence,
    overallPassed: allPassed
  };

  const reportPath = path.join(cwd, ".salacia", "journal", `release-gate-${Date.now()}.json`);
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
  if (!allPassed) process.exit(1);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
