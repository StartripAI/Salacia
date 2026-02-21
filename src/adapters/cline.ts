import fs from "node:fs/promises";
import path from "node:path";
import type {
  AdapterCapability,
  BridgeDispatchResult,
  BridgeEnvelope,
  BridgeHealthReport,
  DispatchContext
} from "./base.js";
import { UnifiedBridgeAdapter } from "./base.js";

export class ClineAdapter extends UnifiedBridgeAdapter {
  name = "cline";
  kind = "ide-bridge" as const;
  supportLevel = "bridge" as const;

  capabilities(): AdapterCapability[] {
    return ["bridge-tasks", "approve", "verify", "bridge-status"];
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async health(cwd: string): Promise<BridgeHealthReport> {
    return {
      target: this.name,
      available: true,
      checks: [{ name: "bridge", ok: true, detail: path.join(cwd, ".cline") }]
    };
  }

  protected async dispatch(envelope: BridgeEnvelope, context: DispatchContext): Promise<BridgeDispatchResult> {
    const dir = path.join(context.cwd, ".cline");
    await fs.mkdir(dir, { recursive: true });
    const stepFile = path.join(dir, `salacia-step-${envelope.stepId}.md`);

    const content = [
      `# Salacia Step ${envelope.stepId}`,
      "",
      `Contract: ${envelope.contractId}`,
      `Stage: ${envelope.stage}`,
      `Risk approval required: ${String(envelope.payload.summary.toLowerCase().includes("high"))}`,
      "",
      "Verification commands:",
      ...envelope.payload.verification.map((v: string) => `- ${v}`)
    ].join("\n");

    await fs.writeFile(stepFile, content, "utf8");

    return {
      success: true,
      rawOutput: `Cline bridge step synced: ${stepFile}`,
      artifacts: [stepFile],
      exitCode: 0
    };
  }
}
