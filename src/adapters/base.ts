import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  AdapterCapability,
  AdapterCapabilityMatrix,
  AdapterKind,
  BridgeDispatchResult,
  BridgeEnvelope,
  BridgeHealthReport,
  ExecuteOptions,
  ExecutionResult,
  Plan,
  PlanStep,
  SupportLevel,
  ValidationResult
} from "../core/types.js";
import { getSalaciaPaths } from "../core/paths.js";

const execFileAsync = promisify(execFile);

export interface ExecutorAdapter {
  name: string;
  kind: AdapterKind;
  supportLevel: SupportLevel;
  capabilities(): AdapterCapability[];
  health(cwd: string): Promise<BridgeHealthReport>;
  isAvailable(): Promise<boolean>;
  execute(plan: Plan, options: ExecuteOptions): Promise<ExecutionResult>;
  validate(result: ExecutionResult): Promise<ValidationResult>;
  matrixRow(): Promise<AdapterCapabilityMatrix>;
}

export interface DispatchContext {
  cwd: string;
  mode: "auto" | "cli" | "sdk";
  dryRun: boolean;
}

export abstract class UnifiedBridgeAdapter implements ExecutorAdapter {
  abstract name: string;
  abstract kind: AdapterKind;
  abstract supportLevel: SupportLevel;

  abstract capabilities(): AdapterCapability[];
  abstract isAvailable(): Promise<boolean>;
  abstract health(cwd: string): Promise<BridgeHealthReport>;

  protected buildEnvelope(plan: Plan, step: PlanStep, options: ExecuteOptions): BridgeEnvelope {
    return {
      id: `${this.name}-${step.id}-${Date.now()}`,
      createdAt: new Date().toISOString(),
      adapter: this.name,
      stage: options.stage ?? "exec",
      contractId: plan.contractId,
      stepId: step.id,
      dryRun: Boolean(options.dryRun),
      payload: {
        summary: `${plan.summary} -> ${step.id}`,
        verification: step.verification,
        expectedArtifacts: step.expectedArtifacts
      }
    };
  }

  protected abstract dispatch(envelope: BridgeEnvelope, context: DispatchContext): Promise<BridgeDispatchResult>;

  protected async collectEvidence(
    envelope: BridgeEnvelope,
    dispatch: BridgeDispatchResult,
    cwd: string
  ): Promise<string> {
    const journalRoot = path.join(getSalaciaPaths(cwd).journal, this.name);
    await fs.mkdir(journalRoot, { recursive: true });

    const evidencePath = path.join(journalRoot, `${envelope.id}.json`);
    await fs.writeFile(
      evidencePath,
      JSON.stringify(
        {
          envelope,
          dispatch,
          recordedAt: new Date().toISOString()
        },
        null,
        2
      ),
      "utf8"
    );

    return evidencePath;
  }

  async execute(plan: Plan, options: ExecuteOptions): Promise<ExecutionResult> {
    const startedAt = new Date().toISOString();
    const artifacts: string[] = [];
    const outputs: string[] = [];
    const failures: string[] = [];
    const mode = options.mode ?? "auto";

    for (const step of plan.steps) {
      const envelope = this.buildEnvelope(plan, step, options);
      const dispatch = await this.dispatch(envelope, {
        cwd: options.cwd,
        mode,
        dryRun: Boolean(options.dryRun)
      });

      const evidencePath = await this.collectEvidence(envelope, dispatch, options.cwd);
      artifacts.push(evidencePath, ...dispatch.artifacts);
      outputs.push(dispatch.rawOutput.trim());
      if (!dispatch.success) {
        failures.push(`${step.id}: ${dispatch.rawOutput}`);
      }
    }

    const success = failures.length === 0;
    const finishedAt = new Date().toISOString();
    return {
      adapter: this.name,
      startedAt,
      finishedAt,
      success,
      summary: success ? "Bridge dispatch completed" : "Bridge dispatch had failures",
      output: success ? outputs.filter(Boolean).join("\n") : failures.join("\n"),
      artifacts,
      metadata: {
        supportLevel: this.supportLevel,
        kind: this.kind,
        steps: plan.steps.length
      }
    };
  }

  async validate(result: ExecutionResult): Promise<ValidationResult> {
    return {
      valid: result.success,
      messages: result.success ? ["Execution result valid"] : [result.output || "Execution failed"]
    };
  }

  async matrixRow(): Promise<AdapterCapabilityMatrix> {
    const available = await this.isAvailable();
    const health = await this.health(process.cwd());
    const notes = health.checks
      .filter((c) => !c.ok)
      .map((c) => `${c.name}: ${c.detail}`)
      .join("; ");
    return {
      target: this.name,
      kind: this.kind,
      available,
      supportLevel: this.supportLevel,
      capabilities: this.capabilities(),
      ...(notes ? { notes } : {})
    };
  }
}

export async function commandExists(command: string): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      await execFileAsync("where", [command]);
    } else {
      await execFileAsync("sh", ["-lc", `command -v ${command}`]);
    }
    return true;
  } catch {
    return false;
  }
}

export async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
  timeout = 120_000
): Promise<{ success: boolean; output: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      env,
      timeout,
      maxBuffer: 10 * 1024 * 1024
    });
    return {
      success: true,
      output: `${stdout}\n${stderr}`.trim(),
      exitCode: 0
    };
  } catch (error) {
    const err = error as Error & { code?: number; stdout?: string; stderr?: string };
    return {
      success: false,
      output: `${err.stdout ?? ""}\n${err.stderr ?? ""}\n${err.message}`.trim(),
      exitCode: typeof err.code === "number" ? err.code : 1
    };
  }
}

export function summarizePlan(plan: Plan): string {
  return `Contract ${plan.contractId} with ${plan.steps.length} steps: ${plan.summary}`;
}

export type {
  AdapterCapability,
  BridgeDispatchResult,
  BridgeEnvelope,
  BridgeHealthReport
} from "../core/types.js";
