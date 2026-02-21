import fs from "node:fs/promises";
import path from "node:path";
import { ensureSalaciaDirs, type SalaciaPaths } from "./paths.js";

const DEFAULT_CONTRACT = `identity:
  id: salacia-contract-default
  version: 1
  repo: current
  createdAt: 1970-01-01T00:00:00.000Z
  createdBy: salacia
intent:
  goals:
    - Deliver production-grade outcome from vibe input
  constraints:
    - Keep changes auditable and reversible
  nonGoals:
    - Introduce unrelated refactors
  assumptions:
    - Node.js >=20 available
scope:
  inScope:
    - src/**
  outOfScope:
    - secrets/**
  interfacesTouched:
    - CLI
  dataTouched:
    - .salacia/**
plan:
  steps:
    - id: analyze
      riskLevel: low
      expectedArtifacts:
        - .salacia/plans/latest.json
      verification:
        - npm run lint
guardrails:
  invariants:
    - no plaintext secrets in repository
  protectedPaths:
    - .env
    - secrets/
  approvalPolicy: require-approval-on-high-risk
verification:
  commands:
    - npm run lint
    - npm test
evidence:
  runLogs: []
  snapshotFingerprint: null
  verificationResults: []
interop:
  executors:
    - claude-code
    - codex
    - opencode
    - cursor
    - cline
    - vscode
    - antigravity
  protocols:
    - mcp
    - acp
`;

const DEFAULT_SPEC = `# Salacia Spec\n\n## Goal\nDescribe the desired outcome.\n\n## Scope\n- In Scope:\n- Out of Scope:\n\n## Acceptance Criteria\n- [ ] Functional behavior verified\n- [ ] Regression checks pass\n- [ ] Rollback path documented\n\n## Verification\n- npm run lint\n- npm test\n`;

export interface InitResult {
  paths: SalaciaPaths;
  created: string[];
}

async function writeIfMissing(filePath: string, content: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return false;
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
    return true;
  }
}

export async function initRepository(root = process.cwd()): Promise<InitResult> {
  const paths = await ensureSalaciaDirs(root);
  const created: string[] = [];

  const files: Array<[string, string]> = [
    [path.join(paths.contracts, "default.yaml"), DEFAULT_CONTRACT],
    [path.join(paths.specs, "default.md"), DEFAULT_SPEC],
    [path.join(paths.salacia, "workflow.md"), "# Salacia Workflow\n\nPlan -> Converge -> Execute -> Verify -> Converge\n"]
  ];

  for (const [filePath, content] of files) {
    if (await writeIfMissing(filePath, content)) {
      created.push(filePath);
    }
  }

  return { paths, created };
}
