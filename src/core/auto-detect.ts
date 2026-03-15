import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExecutorAdapter } from "../adapters/base.js";
import { buildAdapterRegistry } from "../adapters/registry.js";

const execFileAsync = promisify(execFile);

// ── Adapter Auto-Detection ──────────────────────────────────────────

export interface AgentProbe {
  name: string;
  kind: "executor" | "ide-bridge";
  available: boolean;
  version: string | null;
  path: string | null;
}

export interface AdapterDetectionResult {
  adapter: ExecutorAdapter;
  source: "auto" | "config";
  candidates: AgentProbe[];
  reason: string;
}

const EXECUTOR_PRIORITY = ["claude-code", "codex", "opencode"];

async function probeAgentVersion(command: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(command, ["--version"], {
      timeout: 15_000,
      maxBuffer: 1024 * 1024
    });
    return String(stdout).trim().slice(0, 100) || null;
  } catch {
    return null;
  }
}

async function resolveAgentPath(command: string): Promise<string | null> {
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const { stdout } = await execFileAsync(cmd, [command], {
      timeout: 10_000,
      maxBuffer: 1024 * 1024
    });
    return String(stdout).trim().split("\n")[0]?.trim() || null;
  } catch {
    return null;
  }
}

const AGENT_COMMANDS: Record<string, string> = {
  "claude-code": "claude",
  "codex": "codex",
  "opencode": "opencode"
};

export async function probeAllAgents(): Promise<AgentProbe[]> {
  const registry = buildAdapterRegistry();
  const probes: AgentProbe[] = [];

  for (const adapter of registry) {
    const command = AGENT_COMMANDS[adapter.name];
    const available = await adapter.isAvailable();

    let version: string | null = null;
    let agentPath: string | null = null;
    if (available && command) {
      [version, agentPath] = await Promise.all([
        probeAgentVersion(command),
        resolveAgentPath(command)
      ]);
    }

    probes.push({
      name: adapter.name,
      kind: adapter.kind,
      available,
      version,
      path: agentPath
    });
  }

  return probes;
}

export async function detectAdapter(configPreference?: string): Promise<AdapterDetectionResult> {
  const registry = buildAdapterRegistry();
  const probes = await probeAllAgents();

  if (configPreference) {
    const adapter = registry.find((a) => a.name === configPreference);
    if (adapter) {
      const probe = probes.find((p) => p.name === configPreference);
      if (probe?.available) {
        return {
          adapter,
          source: "config",
          candidates: probes,
          reason: `Using configured adapter: ${configPreference}`
        };
      }
    }
  }

  for (const name of EXECUTOR_PRIORITY) {
    const adapter = registry.find((a) => a.name === name);
    const probe = probes.find((p) => p.name === name);
    if (adapter && probe?.available && adapter.kind === "executor") {
      return {
        adapter,
        source: "auto",
        candidates: probes,
        reason: `Auto-detected executor: ${name} (${probe.path ?? "available"})`
      };
    }
  }

  const anyExecutor = registry.find((a) => {
    const probe = probes.find((p) => p.name === a.name);
    return a.kind === "executor" && probe?.available;
  });

  if (anyExecutor) {
    return {
      adapter: anyExecutor,
      source: "auto",
      candidates: probes,
      reason: `Fallback executor: ${anyExecutor.name}`
    };
  }

  throw new Error(
    "No AI coding agent found. Install one of: claude (npm i -g @anthropic-ai/claude-code), codex (npm i -g @openai/codex)"
  );
}

// ── Project & Verification Auto-Detection ───────────────────────────

export type ProjectType = "node" | "python" | "go" | "rust" | "java" | "unknown";

export interface ProjectProbe {
  type: ProjectType;
  testCommands: string[];
  lintCommands: string[];
  buildCommands: string[];
  hasGit: boolean;
  gitClean: boolean;
  detectedFiles: string[];
}

interface DetectionRule {
  type: ProjectType;
  marker: string;
  detect: (cwd: string, content: string) => { test: string[]; lint: string[]; build: string[] };
}

function parsePackageJsonScripts(content: string): { test: string[]; lint: string[]; build: string[] } {
  const test: string[] = [];
  const lint: string[] = [];
  const build: string[] = [];

  try {
    const pkg = JSON.parse(content) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};

    if (scripts.test && !scripts.test.includes("no test specified")) {
      test.push("npm test");
    }
    if (scripts.lint) lint.push("npm run lint");
    if (scripts.typecheck) lint.push("npm run typecheck");
    if (scripts.build) build.push("npm run build");
  } catch {
    // invalid JSON
  }

  return { test, lint, build };
}

const DETECTION_RULES: DetectionRule[] = [
  {
    type: "node",
    marker: "package.json",
    detect: (_cwd, content) => parsePackageJsonScripts(content)
  },
  {
    type: "python",
    marker: "pyproject.toml",
    detect: (_cwd, content) => ({
      test: content.includes("[tool.pytest") || content.includes("pytest") ? ["pytest"] : ["python -m pytest"],
      lint: content.includes("ruff") ? ["ruff check ."] : content.includes("flake8") ? ["flake8 ."] : [],
      build: []
    })
  },
  {
    type: "python",
    marker: "requirements.txt",
    detect: () => ({
      test: ["python -m pytest"],
      lint: [],
      build: []
    })
  },
  {
    type: "go",
    marker: "go.mod",
    detect: () => ({
      test: ["go test ./..."],
      lint: ["go vet ./..."],
      build: ["go build ./..."]
    })
  },
  {
    type: "rust",
    marker: "Cargo.toml",
    detect: () => ({
      test: ["cargo test"],
      lint: ["cargo clippy"],
      build: ["cargo build"]
    })
  },
  {
    type: "java",
    marker: "pom.xml",
    detect: () => ({
      test: ["mvn test"],
      lint: [],
      build: ["mvn compile"]
    })
  },
  {
    type: "java",
    marker: "build.gradle",
    detect: () => ({
      test: ["gradle test"],
      lint: [],
      build: ["gradle build"]
    })
  }
];

async function checkGitStatus(cwd: string): Promise<{ hasGit: boolean; gitClean: boolean }> {
  try {
    await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd, timeout: 10_000 });
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd, timeout: 10_000 });
    return { hasGit: true, gitClean: String(stdout).trim().length === 0 };
  } catch {
    return { hasGit: false, gitClean: false };
  }
}

export async function detectProject(cwd: string): Promise<ProjectProbe> {
  const detectedFiles: string[] = [];
  let projectType: ProjectType = "unknown";
  const testCommands: string[] = [];
  const lintCommands: string[] = [];
  const buildCommands: string[] = [];

  for (const rule of DETECTION_RULES) {
    const filePath = path.join(cwd, rule.marker);
    try {
      const content = await fs.readFile(filePath, "utf8");
      detectedFiles.push(rule.marker);

      if (projectType === "unknown") {
        projectType = rule.type;
      }

      const detected = rule.detect(cwd, content);
      for (const cmd of detected.test) {
        if (!testCommands.includes(cmd)) testCommands.push(cmd);
      }
      for (const cmd of detected.lint) {
        if (!lintCommands.includes(cmd)) lintCommands.push(cmd);
      }
      for (const cmd of detected.build) {
        if (!buildCommands.includes(cmd)) buildCommands.push(cmd);
      }
    } catch {
      // file not found
    }
  }

  // Check for Makefile with test target
  try {
    const makefile = await fs.readFile(path.join(cwd, "Makefile"), "utf8");
    detectedFiles.push("Makefile");
    if (/^test\s*:/m.test(makefile) && !testCommands.includes("make test")) {
      testCommands.push("make test");
    }
  } catch {
    // no Makefile
  }

  const { hasGit, gitClean } = await checkGitStatus(cwd);

  return {
    type: projectType,
    testCommands,
    lintCommands,
    buildCommands,
    hasGit,
    gitClean,
    detectedFiles
  };
}
