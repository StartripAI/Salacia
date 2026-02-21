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

export class AntigravityAdapter extends UnifiedBridgeAdapter {
  name = "antigravity";
  kind = "ide-bridge" as const;
  supportLevel = "bridge" as const;

  capabilities(): AdapterCapability[] {
    return ["bridge-rules", "bridge-tasks", "approve", "bridge-status"];
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async health(cwd: string): Promise<BridgeHealthReport> {
    return {
      target: this.name,
      available: true,
      checks: [{ name: "bridge-mode", ok: true, detail: "v0.1 bridge-capability mode" }]
    };
  }

  protected async dispatch(envelope: BridgeEnvelope, context: DispatchContext): Promise<BridgeDispatchResult> {
    const dir = path.join(context.cwd, ".antigravity");
    await fs.mkdir(dir, { recursive: true });

    const payloadPath = path.join(dir, `salacia-${envelope.stepId}.json`);
    const payload = {
      contractId: envelope.contractId,
      stepId: envelope.stepId,
      stage: envelope.stage,
      requiresApproval: true,
      verification: envelope.payload.verification
    };

    await fs.writeFile(payloadPath, JSON.stringify(payload, null, 2), "utf8");

    return {
      success: true,
      rawOutput: `Antigravity bridge payload synced: ${payloadPath}`,
      artifacts: [payloadPath],
      exitCode: 0
    };
  }
}
