import type {
  AdapterCapability,
  BridgeDispatchResult,
  BridgeEnvelope,
  BridgeHealthReport,
  DispatchContext
} from "./base.js";
import { UnifiedBridgeAdapter, commandExists, resolveCommand, runCommand } from "./base.js";

const MODEL_SOURCE = "user-endpoint-cli";

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
    const claudePath = await resolveCommand("claude");
    const available = Boolean(claudePath);
    const hasToken = Boolean((process.env.ANTHROPIC_AUTH_TOKEN ?? "").trim());
    return {
      target: this.name,
      available,
      checks: [
        {
          name: "cli",
          ok: available,
          detail: available ? `claude command found: ${claudePath}` : "claude command missing"
        },
        {
          name: "endpoint-source",
          ok: true,
          detail: "Execution is hard-locked to user-side CLI endpoint capabilities"
        },
        {
          name: "token",
          ok: hasToken,
          detail: hasToken
            ? "ANTHROPIC_AUTH_TOKEN present in runtime env"
            : "ANTHROPIC_AUTH_TOKEN not set; relying on user-side Claude CLI login/session"
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

    return this.dispatchWithCli(prompt, context);
  }

  private async dispatchWithCli(prompt: string, context: DispatchContext): Promise<BridgeDispatchResult> {
    const claudeCommand = await resolveCommand("claude");
    if (!claudeCommand) {
      return {
        success: false,
        rawOutput: "Claude CLI not found on user endpoint; Salacia only uses user-side endpoint capabilities.",
        artifacts: [],
        exitCode: 2,
        metadata: { mode: "cli", source: MODEL_SOURCE }
      };
    }

    const env = { ...process.env };
    const token = (process.env.ANTHROPIC_AUTH_TOKEN ?? "").trim();
    const baseUrl = (process.env.ANTHROPIC_BASE_URL ?? "").trim();
    if (token) {
      env.ANTHROPIC_AUTH_TOKEN = token;
    }
    if (baseUrl) {
      env.ANTHROPIC_BASE_URL = baseUrl;
    }

    if (context.dryRun) {
      const probe = await runCommand(claudeCommand, ["--version"], context.cwd, env, 30_000);
      return {
        success: probe.success,
        rawOutput: probe.success
          ? `Claude user-endpoint probe succeeded (${claudeCommand})\n${probe.output}`
          : `Claude user-endpoint probe failed (${claudeCommand})\n${probe.output}`,
        artifacts: [],
        exitCode: probe.exitCode,
        metadata: { mode: "cli", source: MODEL_SOURCE, probe: "version" }
      };
    }

    const model = (process.env.CLAUDE_MODEL ?? "").trim();
    const args = model ? ["-p", "--model", model, prompt] : ["-p", prompt];

    const result = await runCommand(claudeCommand, args, context.cwd, env);

    return {
      success: result.success,
      rawOutput: result.output,
      artifacts: [],
      exitCode: result.exitCode,
      metadata: { mode: "cli", source: MODEL_SOURCE }
    };
  }
}
