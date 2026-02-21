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

export class VSCodeAdapter extends UnifiedBridgeAdapter {
  name = "vscode";
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
      checks: [{ name: "workspace", ok: true, detail: cwd }]
    };
  }

  protected async dispatch(envelope: BridgeEnvelope, context: DispatchContext): Promise<BridgeDispatchResult> {
    const vscodeDir = path.join(context.cwd, ".vscode");
    await fs.mkdir(vscodeDir, { recursive: true });

    const taskPath = path.join(vscodeDir, "tasks.json");
    const tasks = {
      version: "2.0.0",
      tasks: envelope.payload.verification.map((command: string, index: number) => ({
        label: `Salacia ${envelope.stepId} #${index + 1}`,
        type: "shell",
        command,
        problemMatcher: []
      }))
    };

    await fs.writeFile(taskPath, JSON.stringify(tasks, null, 2), "utf8");

    return {
      success: true,
      rawOutput: `VSCode tasks synced: ${taskPath}`,
      artifacts: [taskPath],
      exitCode: 0
    };
  }
}
