import type {
  AdapterCapability,
  BridgeDispatchResult,
  BridgeEnvelope,
  BridgeHealthReport,
  DispatchContext
} from "./base.js";
import { UnifiedBridgeAdapter, commandExists, runCommand } from "./base.js";

export class ClaudeCodeAdapter extends UnifiedBridgeAdapter {
  name = "claude-code";
  kind = "executor" as const;
  supportLevel = "ga" as const;

  capabilities(): AdapterCapability[] {
    return ["plan", "execute", "verify", "rollback"];
  }

  async isAvailable(): Promise<boolean> {
    return commandExists("claude");
  }

  async health(cwd: string): Promise<BridgeHealthReport> {
    const available = await this.isAvailable();
    return {
      target: this.name,
      available,
      checks: [
        {
          name: "cli",
          ok: available,
          detail: available ? "claude command found" : "claude command missing"
        },
        {
          name: "token",
          ok: Boolean(process.env.ANTHROPIC_AUTH_TOKEN),
          detail: process.env.ANTHROPIC_AUTH_TOKEN
            ? "ANTHROPIC_AUTH_TOKEN is present"
            : "ANTHROPIC_AUTH_TOKEN not set"
        }
      ]
    };
  }

  protected async dispatch(envelope: BridgeEnvelope, context: DispatchContext): Promise<BridgeDispatchResult> {
    const prompt = [
      "You are executing a Salacia bridge envelope.",
      `Stage: ${envelope.stage}`,
      `Contract: ${envelope.contractId}`,
      `Step: ${envelope.stepId}`,
      `Summary: ${envelope.payload.summary}`,
      `DryRun: ${String(context.dryRun)}`,
      "Return concise result and risk notes."
    ].join("\n");

    if (context.mode === "sdk" || context.mode === "auto") {
      const sdkResult = await this.dispatchWithSdk(prompt, context);
      if (sdkResult.success || context.mode === "sdk") {
        return sdkResult;
      }
    }

    return this.dispatchWithCli(prompt, context);
  }

  private async dispatchWithSdk(prompt: string, context: DispatchContext): Promise<BridgeDispatchResult> {
    try {
      const sdk: any = await import("@anthropic-ai/claude-agent-sdk/sdk.mjs");
      if (!sdk?.unstable_v2_prompt) {
        return {
          success: false,
          rawOutput: "Claude SDK unavailable: unstable_v2_prompt not found",
          artifacts: [],
          exitCode: 2
        };
      }

      const response = await sdk.unstable_v2_prompt(prompt, {
        cwd: context.cwd,
        model: process.env.CLAUDE_MODEL ?? "claude-opus-4-6",
        permissionMode: context.dryRun ? "plan" : "default"
      });

      return {
        success: true,
        rawOutput: JSON.stringify(response, null, 2),
        artifacts: [],
        exitCode: 0,
        metadata: { mode: "sdk" }
      };
    } catch (error) {
      return {
        success: false,
        rawOutput: `Claude SDK execution failed: ${(error as Error).message}`,
        artifacts: [],
        exitCode: 2,
        metadata: { mode: "sdk" }
      };
    }
  }

  private async dispatchWithCli(prompt: string, context: DispatchContext): Promise<BridgeDispatchResult> {
    if (!process.env.ANTHROPIC_AUTH_TOKEN) {
      return {
        success: false,
        rawOutput: "ANTHROPIC_AUTH_TOKEN is required for Claude CLI dispatch",
        artifacts: [],
        exitCode: 2,
        metadata: { mode: "cli" }
      };
    }

    const env = {
      ...process.env,
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL ?? "https://yxai.anthropic.edu.pl",
      ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN
    };

    const result = await runCommand(
      "claude",
      ["-p", "--model", process.env.CLAUDE_MODEL ?? "claude-opus-4-6", prompt],
      context.cwd,
      env
    );

    return {
      success: result.success,
      rawOutput: result.output,
      artifacts: [],
      exitCode: result.exitCode,
      metadata: { mode: "cli" }
    };
  }
}
