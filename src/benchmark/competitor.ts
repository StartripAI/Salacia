import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { findAdapter } from "../adapters/registry.js";
import { ensureSalaciaDirs } from "../core/paths.js";
import type {
  CompetitorId,
  ExecuteOptions,
  Plan,
  CompetitorRunReport,
  CompetitorRunResult,
  CompetitorTaskSpec
} from "../core/types.js";

const execFileAsync = promisify(execFile);

const DEFAULT_TASK: CompetitorTaskSpec = {
  id: "seed.login-validation-bug",
  title: "Fix login validation and keep tests green",
  prompt:
    "Fix the login validation bug in src/auth.js so whitespace-only usernames are rejected while keeping the same API. Keep the implementation simple and run tests.",
  verifyCommand: ["node", "--test"]
};

export interface RunCompetitorBenchmarkOptions {
  cwd?: string;
  competitors?: CompetitorId[];
  task?: CompetitorTaskSpec;
  timeoutMs?: number;
}

const SUPPORTED_COMPETITORS: CompetitorId[] = [
  "salacia",
  "codex",
  "claude",
  "aider",
  "cline",
  "continue",
  "opencode",
  "cursor",
  "trellis"
];

const COMPETITOR_BINARIES = new Map<CompetitorId, string>([
  ["codex", "codex"],
  ["claude", "claude"],
  ["aider", "aider"],
  ["cline", "cline"],
  ["continue", "continue"],
  ["opencode", "opencode"],
  ["cursor", "cursor"],
  ["trellis", "trellis"]
]);

type SalaciaBackend = "codex" | "claude-code" | "control";

interface SalaciaExecutionResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  measured: boolean;
  available: boolean;
  reason?: string;
}

interface CompetitorCommandSpec {
  command: string;
  args: string[];
  binary?: string;
  source: "builtin" | "env-override";
  execMode?: "execFile" | "shell" | "expect";
}

interface OverrideResolution {
  command: CompetitorCommandSpec | null;
  blockedReason?: string;
}

function shellQuote(value: string): string {
  if (value.length === 0) {
    return "''";
  }
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function buildShellScript(command: string, args: string[]): string {
  return [command, ...args].map((value) => shellQuote(value)).join(" ");
}

function tclDoubleQuote(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")}"`;
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  execMode: "execFile" | "shell" | "expect" = "execFile"
): Promise<{ ok: boolean; exitCode: number; stdout: string; stderr: string }> {
  if (execMode === "expect") {
    const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
    const tclLines = [
      "set cmd [list]",
      ...[command, ...args].map((value) => `lappend cmd ${tclDoubleQuote(value)}`)
    ];
    const script = [
      "log_user 1",
      `set timeout ${timeoutSeconds}`,
      ...tclLines,
      "eval spawn $cmd",
      "expect eof"
    ].join("\n");
    try {
      const { stdout, stderr } = await execFileAsync("expect", ["-c", script], {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 20 * 1024 * 1024
      });
      return {
        ok: true,
        exitCode: 0,
        stdout: String(stdout),
        stderr: String(stderr)
      };
    } catch (error) {
      const e = error as {
        stdout?: string;
        stderr?: string;
        code?: number | string;
        message?: string;
      };
      return {
        ok: false,
        exitCode: typeof e.code === "number" ? e.code : 1,
        stdout: String(e.stdout ?? ""),
        stderr: `${String(e.stderr ?? "")}\n${String(e.message ?? "")}`.trim()
      };
    }
  }

  const runCommandName = execMode === "shell" ? (process.env.SHELL?.trim() || "sh") : command;
  const runArgs = execMode === "shell" ? ["-lc", buildShellScript(command, args)] : args;
  try {
    const { stdout, stderr } = await execFileAsync(runCommandName, runArgs, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024
    });
    return {
      ok: true,
      exitCode: 0,
      stdout: String(stdout),
      stderr: String(stderr)
    };
  } catch (error) {
    const e = error as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      message?: string;
    };
    return {
      ok: false,
      exitCode: typeof e.code === "number" ? e.code : 1,
      stdout: String(e.stdout ?? ""),
      stderr: `${String(e.stderr ?? "")}\n${String(e.message ?? "")}`.trim()
    };
  }
}

async function isCommandAvailable(command: string): Promise<boolean> {
  const checker = process.platform === "win32" ? "where" : "which";
  const result = await runCommand(checker, [command], process.cwd(), 5000);
  return result.ok;
}

async function initSeedRepo(root: string): Promise<void> {
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.mkdir(path.join(root, "tests"), { recursive: true });

  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        name: "salacia-bench-seed",
        version: "0.0.0",
        private: true,
        type: "module",
        scripts: {
          test: "node --test"
        }
      },
      null,
      2
    ),
    "utf8"
  );

  await fs.writeFile(
    path.join(root, "src", "auth.js"),
    [
      "export function validateLogin(username, password) {",
      "  if (typeof username !== \"string\" || typeof password !== \"string\") {",
      "    return false;",
      "  }",
      "  return Boolean(username) && password.length >= 8;",
      "}",
      ""
    ].join("\n"),
    "utf8"
  );

  await fs.writeFile(
    path.join(root, "tests", "auth.test.js"),
    [
      "import assert from \"node:assert/strict\";",
      "import test from \"node:test\";",
      "import { validateLogin } from \"../src/auth.js\";",
      "",
      "test(\"accepts valid username/password\", () => {",
      "  assert.equal(validateLogin(\"alice\", \"12345678\"), true);",
      "});",
      "",
      "test(\"rejects whitespace-only username\", () => {",
      "  assert.equal(validateLogin(\"   \", \"12345678\"), false);",
      "});",
      ""
    ].join("\n"),
    "utf8"
  );

  await runCommand("git", ["init"], root, 20_000);
  await runCommand("git", ["config", "user.email", "salacia-bench@example.com"], root, 10_000);
  await runCommand("git", ["config", "user.name", "Salacia Bench"], root, 10_000);
  await runCommand("git", ["add", "."], root, 20_000);
  await runCommand("git", ["commit", "-m", "seed"], root, 20_000);
}

async function applySalaciaControlPatch(repoPath: string): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number }> {
  const sourcePath = path.join(repoPath, "src", "auth.js");
  const source = await fs.readFile(sourcePath, "utf8");
  const patched = source.replace("return Boolean(username) && password.length >= 8;", "return username.trim().length > 0 && password.length >= 8;");
  if (source === patched) {
    return {
      ok: false,
      exitCode: 1,
      stdout: "",
      stderr: "control patch did not apply"
    };
  }
  await fs.writeFile(sourcePath, patched, "utf8");
  return {
    ok: true,
    exitCode: 0,
    stdout: "salacia control patch applied",
    stderr: ""
  };
}

function resolveSalaciaBackend(): SalaciaBackend {
  const raw = (process.env.BENCH_SALACIA_BACKEND ?? "codex").trim().toLowerCase();
  if (raw === "control") return "control";
  if (raw === "claude" || raw === "claude-code") return "claude-code";
  return "codex";
}

function overrideEnvVarName(competitor: CompetitorId): string {
  return `BENCH_${competitor.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_CMD`;
}

function overrideJsonEnvVarName(competitor: CompetitorId): string {
  return `${overrideEnvVarName(competitor)}_JSON`;
}

function buildOverrideReplacements(task: CompetitorTaskSpec, repoPath: string): Record<string, string> {
  return {
    repo: repoPath,
    cwd: repoPath,
    prompt: task.prompt,
    verify: task.verifyCommand.join(" "),
    taskId: task.id,
    taskTitle: task.title,
    authFile: path.join(repoPath, "src", "auth.js"),
    testFile: path.join(repoPath, "tests", "auth.test.js")
  };
}

function applyTemplate(input: string, replacements: Record<string, string>): string {
  let out = input;
  for (const [key, value] of Object.entries(replacements)) {
    out = out.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }
  return out;
}

function resolveOverrideCommand(
  competitor: CompetitorId,
  task: CompetitorTaskSpec,
  repoPath: string
): OverrideResolution {
  const replacements = buildOverrideReplacements(task, repoPath);
  const jsonEnvVar = overrideJsonEnvVarName(competitor);
  const jsonRaw = process.env[jsonEnvVar]?.trim();

  if (jsonRaw) {
    try {
      const parsed = JSON.parse(jsonRaw) as Partial<{ command: string; args: string[] }>;
      if (typeof parsed.command !== "string" || parsed.command.trim().length === 0) {
        return {
          command: null,
          blockedReason: `${jsonEnvVar} must include a non-empty \"command\" field`
        };
      }
      if (!Array.isArray(parsed.args) || parsed.args.some((arg) => typeof arg !== "string")) {
        return {
          command: null,
          blockedReason: `${jsonEnvVar} must include string array \"args\"`
        };
      }
      const command = applyTemplate(parsed.command, replacements);
      const args = parsed.args.map((arg) => applyTemplate(arg, replacements));
      return {
        command: {
          command,
          args,
          source: "env-override"
        }
      };
    } catch (error) {
      return {
        command: null,
        blockedReason: `${jsonEnvVar} failed to parse JSON: ${(error as Error).message}`
      };
    }
  }

  const legacyEnvVar = overrideEnvVarName(competitor);
  const template = process.env[legacyEnvVar]?.trim();
  if (!template) return { command: null };

  if (process.env.BENCH_ALLOW_LEGACY_SHELL_TEMPLATE !== "1") {
    return {
      command: null,
      blockedReason: `${legacyEnvVar} is disabled by default; use ${jsonEnvVar} or set BENCH_ALLOW_LEGACY_SHELL_TEMPLATE=1`
    };
  }

  console.error(
    `[salacia-bench] WARNING: using legacy shell override ${legacyEnvVar}; this path is high risk and not recommended.`
  );
  const script = applyTemplate(template, replacements);
  return {
    command: {
      command: "sh",
      args: ["-lc", script],
      source: "env-override"
    }
  };
}

async function runSalaciaAdapterExecution(
  repoPath: string,
  task: CompetitorTaskSpec
): Promise<SalaciaExecutionResult> {
  const backend = resolveSalaciaBackend();
  if (backend === "control") {
    const control = await applySalaciaControlPatch(repoPath);
    return {
      ...control,
      measured: false,
      available: true,
      reason: "salacia control fallback (set BENCH_SALACIA_BACKEND=codex|claude-code for measured run)"
    };
  }

  const adapter = findAdapter(backend);
  if (!adapter) {
    return {
      ok: false,
      exitCode: 1,
      stdout: "",
      stderr: `adapter not found: ${backend}`,
      measured: false,
      available: false,
      reason: `adapter not found: ${backend}`
    };
  }

  const available = await adapter.isAvailable();
  if (!available) {
    return {
      ok: false,
      exitCode: 1,
      stdout: "",
      stderr: `${backend} adapter unavailable`,
      measured: false,
      available: false,
      reason: `${backend} adapter unavailable`
    };
  }

  const plan: Plan = {
    contractId: `salacia-bench-${Date.now()}`,
    generatedAt: new Date().toISOString(),
    summary: task.prompt,
    steps: [
      {
        id: "fix-seed-bug",
        riskLevel: "medium",
        expectedArtifacts: ["src/auth.js"],
        verification: [task.verifyCommand.join(" ")]
      }
    ]
  };
  const options: ExecuteOptions = {
    cwd: repoPath,
    dryRun: false,
    stage: "exec",
    mode: "cli"
  };

  const executed = await adapter.execute(plan, options);
  return {
    ok: executed.success,
    exitCode: executed.success ? 0 : 1,
    stdout: executed.output,
    stderr: executed.success ? "" : executed.summary,
    measured: true,
    available: true,
    ...(executed.success ? {} : { reason: `salacia ${backend} execution failed` })
  };
}

function builtinCommandForCompetitor(
  competitor: CompetitorId,
  task: CompetitorTaskSpec,
  repoPath: string
): CompetitorCommandSpec | null {
  switch (competitor) {
    case "codex": {
      const model = process.env.BENCH_CODEX_MODEL ?? "gpt-5-codex";
      const reasoningEffort = process.env.BENCH_CODEX_REASONING_EFFORT ?? "high";
      return {
        command: "codex",
        args: [
          "exec",
          "--cd",
          repoPath,
          "--sandbox",
          "workspace-write",
          "--skip-git-repo-check",
          "-m",
          model,
          "-c",
          `model_reasoning_effort="${reasoningEffort}"`,
          task.prompt
        ],
        binary: "codex",
        source: "builtin"
      };
    }
    case "claude":
      const model = process.env.BENCH_CLAUDE_MODEL ?? "opus";
      const useDangerousSkipPermissions = process.env.BENCH_CLAUDE_SKIP_PERMISSIONS !== "0";
      const claudeArgs = [
        "-p",
        "--model",
        model,
        "--output-format",
        "json"
      ];
      if (useDangerousSkipPermissions) {
        claudeArgs.push("--dangerously-skip-permissions");
      } else {
        claudeArgs.push("--permission-mode", "bypassPermissions");
      }
      claudeArgs.push("--add-dir", repoPath, "--", task.prompt);
      return {
        command: "claude",
        args: claudeArgs,
        binary: "claude",
        source: "builtin",
        execMode: "expect"
      };
    case "aider":
      return {
        command: "aider",
        args: [
          "--yes-always",
          "--no-auto-commits",
          "--no-check-update",
          "--no-show-release-notes",
          "--no-analytics",
          "--message",
          task.prompt,
          "src/auth.js",
          "tests/auth.test.js"
        ],
        binary: "aider",
        source: "builtin"
      };
    default:
      return null;
  }
}

async function changedFiles(repoPath: string): Promise<string[]> {
  const result = await runCommand("git", ["status", "--porcelain"], repoPath, 20_000);
  if (!result.ok) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.replace(/\r/g, ""))
    .filter((line) => line.length > 3)
    .map((line) => line.slice(3).trim());
}

async function runVerify(repoPath: string, verify: string[], timeoutMs: number): Promise<{ ok: boolean; exitCode: number }> {
  const [command, ...args] = verify;
  if (!command) {
    return { ok: false, exitCode: 1 };
  }
  const result = await runCommand(command, args, repoPath, timeoutMs);
  return {
    ok: result.ok,
    exitCode: result.exitCode
  };
}

async function writeResultLogs(dirPath: string, stdout: string, stderr: string): Promise<{ stdoutPath: string; stderrPath: string }> {
  const stdoutPath = path.join(dirPath, "stdout.log");
  const stderrPath = path.join(dirPath, "stderr.log");
  await fs.writeFile(stdoutPath, stdout, "utf8");
  await fs.writeFile(stderrPath, stderr, "utf8");
  return { stdoutPath, stderrPath };
}

function extractReasonLine(output: string): string | undefined {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.includes("NotOpenSSLWarning"))
    .filter((line) => line !== "warnings.warn(")
    .filter((line) => !line.startsWith("Command failed:"))
    .filter((line) => !line.startsWith("Detected dumb terminal"));
  const preferred = lines.find((line) =>
    /(no llm model|api key|api keys|unauthorized|forbidden|timeout|timed out|error|failed|not found)/i.test(line)
  );
  return preferred ?? lines[0];
}

async function runSingleCompetitor(
  rootDir: string,
  competitor: CompetitorId,
  task: CompetitorTaskSpec,
  timeoutMs: number
): Promise<CompetitorRunResult> {
  const reportDir = path.join(rootDir, competitor);
  await fs.mkdir(reportDir, { recursive: true });

  if (!SUPPORTED_COMPETITORS.includes(competitor)) {
    const logs = await writeResultLogs(reportDir, "", `unsupported competitor: ${competitor}`);
    return {
      competitor,
      available: false,
      measured: false,
      success: false,
      exitCode: 1,
      durationMs: 0,
      testsPassed: false,
      changedFiles: [],
      repoPath: "",
      stdoutPath: logs.stdoutPath,
      stderrPath: logs.stderrPath,
      reason: "unsupported competitor"
    };
  }

  const repoPath = path.join(reportDir, "repo");
  await fs.mkdir(repoPath, { recursive: true });
  await initSeedRepo(repoPath);

  const started = Date.now();
  let execution: { ok: boolean; exitCode: number; stdout: string; stderr: string };
  let measured = true;
  let available = true;
  let staticReason: string | undefined;
  if (competitor === "salacia") {
    const salaciaRun = await runSalaciaAdapterExecution(repoPath, task);
    execution = {
      ok: salaciaRun.ok,
      exitCode: salaciaRun.exitCode,
      stdout: salaciaRun.stdout,
      stderr: salaciaRun.stderr
    };
    measured = salaciaRun.measured;
    available = salaciaRun.available;
    staticReason = salaciaRun.reason;
    if (!available) {
      const logs = await writeResultLogs(reportDir, execution.stdout, execution.stderr);
      return {
        competitor,
        available: false,
        measured,
        success: false,
        exitCode: execution.exitCode,
        durationMs: 0,
        testsPassed: false,
        changedFiles: [],
        repoPath,
        stdoutPath: logs.stdoutPath,
        stderrPath: logs.stderrPath,
        reason: staticReason ?? "salacia backend unavailable"
      };
    }
  } else {
    const binary = COMPETITOR_BINARIES.get(competitor);
    const override = resolveOverrideCommand(competitor, task, repoPath);
    const command = override.command ?? builtinCommandForCompetitor(competitor, task, repoPath);
    if (!command) {
      const available = override.blockedReason ? true : binary ? await isCommandAvailable(binary) : false;
      const legacyEnvVar = overrideEnvVarName(competitor);
      const jsonEnvVar = overrideJsonEnvVarName(competitor);
      const reason = override.blockedReason
        ? override.blockedReason
        : available
          ? `headless benchmark harness not implemented for ${competitor}; set ${jsonEnvVar} with {"command","args"} (legacy ${legacyEnvVar} requires BENCH_ALLOW_LEGACY_SHELL_TEMPLATE=1)`
          : `${binary ?? competitor} binary not found`;
      const logs = await writeResultLogs(
        reportDir,
        "",
        reason
      );
      return {
        competitor,
        available,
        measured: false,
        success: false,
        exitCode: 1,
        durationMs: 0,
        testsPassed: false,
        changedFiles: [],
        repoPath,
        stdoutPath: logs.stdoutPath,
        stderrPath: logs.stderrPath,
        reason
      };
    }

    if (command.binary && !(await isCommandAvailable(command.binary))) {
      const logs = await writeResultLogs(reportDir, "", `${command.binary} binary not found`);
      return {
        competitor,
        available: false,
        measured: false,
        success: false,
        exitCode: 1,
        durationMs: 0,
        testsPassed: false,
        changedFiles: [],
        repoPath,
        stdoutPath: logs.stdoutPath,
        stderrPath: logs.stderrPath,
        reason: `${command.binary} binary not found`
      };
    }

    if (command.execMode === "expect" && !(await isCommandAvailable("expect"))) {
      const logs = await writeResultLogs(reportDir, "", "expect binary not found");
      return {
        competitor,
        available: false,
        measured: false,
        success: false,
        exitCode: 1,
        durationMs: 0,
        testsPassed: false,
        changedFiles: [],
        repoPath,
        stdoutPath: logs.stdoutPath,
        stderrPath: logs.stderrPath,
        reason: "expect binary not found"
      };
    }

    execution = await runCommand(
      command.command,
      command.args,
      repoPath,
      timeoutMs,
      command.execMode ?? "execFile"
    );
  }
  const durationMs = Date.now() - started;

  const verify = await runVerify(repoPath, task.verifyCommand, timeoutMs);
  const files = await changedFiles(repoPath);
  const logs = await writeResultLogs(reportDir, execution.stdout, execution.stderr);
  const success = execution.ok && verify.ok && files.length > 0;
  const executionHeadline = extractReasonLine(execution.stderr) ?? extractReasonLine(execution.stdout) ?? "";
  const executionFailureReason = execution.exitCode === 143 ? "command timed out" : "execution failed";
  const reason = !execution.ok
    ? executionHeadline.slice(0, 200) || executionFailureReason
    : !verify.ok
      ? "verification command failed"
      : files.length === 0
        ? "no file changes detected"
        : staticReason;

  const baseResult: CompetitorRunResult = {
    competitor,
    available,
    measured,
    success,
    exitCode: execution.exitCode,
    durationMs,
    testsPassed: verify.ok,
    changedFiles: files,
    repoPath,
    stdoutPath: logs.stdoutPath,
    stderrPath: logs.stderrPath
  };

  if (reason) {
    return {
      ...baseResult,
      reason
    };
  }

  return baseResult;
}

export async function runCompetitorBenchmark(options: RunCompetitorBenchmarkOptions = {}): Promise<CompetitorRunReport> {
  const cwd = options.cwd ?? process.cwd();
  const task = options.task ?? DEFAULT_TASK;
  const competitors = options.competitors ?? ["salacia", "codex", "claude", "aider"];
  const timeoutMs = options.timeoutMs ?? 8 * 60 * 1000;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const paths = await ensureSalaciaDirs(cwd);
  const rootDir = path.join(paths.journal, "bench", "competitor-runs", runId);
  await fs.mkdir(rootDir, { recursive: true });

  const results: CompetitorRunResult[] = [];
  for (const competitor of competitors) {
    try {
      results.push(await runSingleCompetitor(rootDir, competitor, task, timeoutMs));
    } catch (error) {
      const reportDir = path.join(rootDir, competitor);
      await fs.mkdir(reportDir, { recursive: true });
      const logs = await writeResultLogs(reportDir, "", String((error as Error).message ?? "unknown competitor run error"));
      results.push({
        competitor,
        available: false,
        measured: false,
        success: false,
        exitCode: 1,
        durationMs: 0,
        testsPassed: false,
        changedFiles: [],
        repoPath: path.join(reportDir, "repo"),
        stdoutPath: logs.stdoutPath,
        stderrPath: logs.stderrPath,
        reason: "interrupted competitor benchmark run"
      });
    }
  }

  const reportPath = path.join(rootDir, "report.json");
  const report: CompetitorRunReport = {
    runId,
    generatedAt: new Date().toISOString(),
    task,
    results,
    reportPath
  };

  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  return report;
}
