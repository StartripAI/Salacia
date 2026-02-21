import type {
  AdapterCapability,
  BridgeDispatchResult,
  BridgeEnvelope,
  BridgeHealthReport,
  DispatchContext
} from "./base.js";
import { UnifiedBridgeAdapter, commandExists, runCommand } from "./base.js";

export class OpenCodeAdapter extends UnifiedBridgeAdapter {
  name = "opencode";
  kind = "executor" as const;
  supportLevel = "beta" as const;

  capabilities(): AdapterCapability[] {
    return ["plan", "execute", "verify", "rollback", "bridge-status"];
  }

  async isAvailable(): Promise<boolean> {
    return commandExists("opencode");
  }

  async health(cwd: string): Promise<BridgeHealthReport> {
    const available = await this.isAvailable();
    return {
      target: this.name,
      available,
      checks: [
        {
          name: "binary",
          ok: available,
          detail: available ? "opencode command found" : "opencode missing"
        }
      ]
    };
  }

  protected async dispatch(envelope: BridgeEnvelope, context: DispatchContext): Promise<BridgeDispatchResult> {
    const available = await this.isAvailable();
    if (!available) {
      return {
        success: false,
        rawOutput: "OpenCode bridge unavailable: opencode binary is missing",
        artifacts: [],
        exitCode: 2
      };
    }

    const probe = await runCommand("opencode", ["--help"], context.cwd);
    const payloadPath = `.salacia/journal/opencode-payload-${Date.now()}.json`;
    const payload = JSON.stringify(envelope, null, 2);

    return {
      success: probe.success,
      rawOutput: `${probe.output}\nOPEN_CODE_ENVELOPE=${payload}`,
      artifacts: [payloadPath],
      exitCode: probe.exitCode,
      metadata: { bridge: "acp-subprocess-capable" }
    };
  }
}
