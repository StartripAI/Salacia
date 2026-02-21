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

export class CursorAdapter extends UnifiedBridgeAdapter {
  name = "cursor";
  kind = "ide-bridge" as const;
  supportLevel = "bridge" as const;

  capabilities(): AdapterCapability[] {
    return ["bridge-rules", "bridge-tasks", "approve", "bridge-status"];
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async health(cwd: string): Promise<BridgeHealthReport> {
    const rulesDir = path.join(cwd, ".cursor", "rules");
    return {
      target: this.name,
      available: true,
      checks: [{ name: "rules-dir", ok: true, detail: rulesDir }]
    };
  }

  protected async dispatch(envelope: BridgeEnvelope, context: DispatchContext): Promise<BridgeDispatchResult> {
    const rulesDir = path.join(context.cwd, ".cursor", "rules");
    await fs.mkdir(rulesDir, { recursive: true });

    const rulePath = path.join(rulesDir, "salacia.mdc");
    const taskPath = path.join(rulesDir, `salacia-${envelope.stepId}.json`);

    await fs.writeFile(
      rulePath,
      [
        "# Salacia Bridge Rules",
        "Use .salacia contracts/specs/plans as source of truth.",
        "Require explicit approval for high-risk steps.",
        `Current contract: ${envelope.contractId}`
      ].join("\n"),
      "utf8"
    );

    await fs.writeFile(taskPath, JSON.stringify(envelope, null, 2), "utf8");

    return {
      success: true,
      rawOutput: `Cursor bridge artifacts synced: ${rulePath}, ${taskPath}`,
      artifacts: [rulePath, taskPath],
      exitCode: 0
    };
  }
}
