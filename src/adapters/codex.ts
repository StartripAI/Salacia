import type {
  AdapterCapability,
  BridgeDispatchResult,
  BridgeEnvelope,
  BridgeHealthReport,
  DispatchContext
} from "./base.js";
import { UnifiedBridgeAdapter, commandExists, runCommand } from "./base.js";

function inWsl(): boolean {
  return Boolean(process.env.WSL_DISTRO_NAME) || Boolean(process.env.WSL_INTEROP);
}

export class CodexAdapter extends UnifiedBridgeAdapter {
  name = "codex";
  kind = "executor" as const;
  supportLevel = "ga" as const;

  capabilities(): AdapterCapability[] {
    return ["plan", "execute", "verify", "rollback"];
  }

  async isAvailable(): Promise<boolean> {
    if (process.platform === "win32" && !inWsl()) {
      return commandExists("wsl");
    }
    return commandExists("codex");
  }

  async health(cwd: string): Promise<BridgeHealthReport> {
    const available = await this.isAvailable();
    const wslRequired = process.platform === "win32" && !inWsl();
    return {
      target: this.name,
      available,
      checks: [
        {
          name: "route",
          ok: true,
          detail: wslRequired ? "Windows route uses WSL" : "Native route"
        },
        {
          name: "binary",
          ok: available,
          detail: available ? "codex route available" : "codex/WSL route unavailable"
        }
      ]
    };
  }

  protected async dispatch(envelope: BridgeEnvelope, context: DispatchContext): Promise<BridgeDispatchResult> {
    const prompt = [
      "Execute/validate Salacia envelope.",
      `Stage: ${envelope.stage}`,
      `Contract: ${envelope.contractId}`,
      `Step: ${envelope.stepId}`,
      `Summary: ${envelope.payload.summary}`,
      `DryRun: ${String(context.dryRun)}`
    ].join("\n");

    let result;
    if (process.platform === "win32" && !inWsl()) {
      result = await runCommand(
        "wsl",
        ["codex", "exec", "--json", "-C", context.cwd, prompt],
        context.cwd
      );
    } else {
      result = await runCommand(
        "codex",
        ["exec", "--json", "-C", context.cwd, prompt],
        context.cwd
      );
    }

    return {
      success: result.success,
      rawOutput: result.output,
      artifacts: [],
      exitCode: result.exitCode,
      metadata: {
        route: process.platform === "win32" && !inWsl() ? "wsl" : "native"
      }
    };
  }
}
