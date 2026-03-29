import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Contract, VerificationSummary, VerifyCommandResult } from "../core/types.js";
import { writeEvidence } from "./evidence.js";

const execAsync = promisify(exec);

export async function runVerificationCommands(
  contractId: string,
  commands: string[],
  cwd = process.cwd(),
  options: { persistEvidence?: boolean; stage?: "step" | "full" } = {}
): Promise<VerificationSummary> {
  const results: VerifyCommandResult[] = [];

  for (const command of commands) {
    try {
      const { stdout, stderr } = await execAsync(command, { cwd, maxBuffer: 5 * 1024 * 1024 });
      results.push({
        command,
        success: true,
        exitCode: 0,
        output: `${stdout}\n${stderr}`.trim()
      });
    } catch (error) {
      const err = error as Error & { code?: number; stdout?: string; stderr?: string };
      results.push({
        command,
        success: false,
        exitCode: err.code ?? 1,
        output: `${err.stdout ?? ""}\n${err.stderr ?? ""}\n${err.message}`.trim()
      });
    }
  }

  const summary: VerificationSummary = {
    success: results.every((r) => r.success),
    results
  };

  if (options.persistEvidence ?? true) {
    summary.evidencePath = await writeEvidence(
      {
        kind: options.stage === "step" ? "verify-step" : "verify-full",
        createdAt: new Date().toISOString(),
        payload: {
          contractId,
          success: summary.success,
          results
        }
      },
      cwd
    );
  }

  return summary;
}

export async function runVerification(
  contract: Contract,
  cwd = process.cwd(),
  options: { persistEvidence?: boolean; stage?: "step" | "full" } = {}
): Promise<VerificationSummary> {
  return runVerificationCommands(contract.identity.id, contract.verification.commands, cwd, options);
}
