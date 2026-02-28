import fs from "node:fs/promises";
import type { IncrementalExecutionSummary } from "./incremental.js";
import type { MultiAgentExecutionSummary } from "./multi-agent.js";
import type { CoordinationDispatchResult, CoordinationProtocol } from "./protocol-dispatch.js";
import type { ConsistencyReport } from "../core/types.js";
import type { VerificationSummary } from "../guardian/verify.js";
import { getRunPaths } from "../core/paths.js";

export type ExecutionTerminalStatus = "pass" | "fail" | "blocked";

export interface ExecutionSessionRecord {
  runId: string;
  contractId: string;
  adapter: string;
  mode: "single" | "multi";
  startedAt: string;
  finishedAt: string;
  status: ExecutionTerminalStatus;
  summary: IncrementalExecutionSummary;
  multiAgent?: MultiAgentExecutionSummary;
  consistency?: ConsistencyReport;
  verification?: VerificationSummary;
  coordination?: {
    protocol: CoordinationProtocol;
    pre: CoordinationDispatchResult;
    post: CoordinationDispatchResult;
  };
  humanGate?: {
    required: boolean;
    reason?: string;
    conflicts?: number;
  };
  snapshot?: {
    id: string;
    label: string;
    createdAt: string;
  };
  rollback?: {
    enabled: boolean;
    attempted: boolean;
    success: boolean | null;
    retries: number;
    snapshotId: string;
    rollbackPath: string | null;
    error: string | null;
  };
}

export async function saveExecutionSession(root: string, runId: string, session: ExecutionSessionRecord): Promise<string> {
  const run = getRunPaths(root, runId);
  await fs.mkdir(run.executionDir, { recursive: true });
  await fs.writeFile(run.session, JSON.stringify(session, null, 2), "utf8");
  return run.session;
}

export async function loadExecutionSession(root: string, runId: string): Promise<ExecutionSessionRecord | null> {
  const run = getRunPaths(root, runId);
  const raw = await fs.readFile(run.session, "utf8").catch(() => "");
  if (!raw) {
    return null;
  }
  return JSON.parse(raw) as ExecutionSessionRecord;
}
