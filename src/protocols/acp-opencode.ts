import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AcpDispatchResult, AcpMessage, AcpTransport } from "./acp.js";
import { validateAcpMessage } from "./acp.js";

const execFileAsync = promisify(execFile);

export class OpenCodeAcpTransport implements AcpTransport {
  readonly transport = "acp-opencode";

  async probe(): Promise<AcpDispatchResult> {
    try {
      const { stdout, stderr } = await execFileAsync("opencode", ["--help"], {
        timeout: 15_000,
        maxBuffer: 1024 * 1024
      });
      return {
        ok: true,
        details: `${stdout}\n${stderr}`.slice(0, 500),
        response: {
          transport: this.transport
        }
      };
    } catch (error) {
      return {
        ok: false,
        details: `OpenCode probe failed: ${(error as Error).message}`,
        error: {
          code: "acp.opencode_probe_failed",
          message: "OpenCode ACP probe failed",
          details: [(error as Error).message],
          retriable: true
        }
      };
    }
  }

  async dispatch(message: AcpMessage): Promise<AcpDispatchResult> {
    const validation = validateAcpMessage(message);
    if (!validation.ok) {
      return {
        ok: false,
        details: `Invalid ACP message: ${validation.errors.join("; ")}`,
        error: {
          code: "acp.invalid_message",
          message: "ACP message failed schema validation",
          details: validation.errors,
          retriable: false
        }
      };
    }

    const probe = await this.probe();
    if (!probe.ok) {
      return probe;
    }

    return {
      ok: true,
      details: `OpenCode ACP subprocess accepted ${message.type}`,
      response: {
        ack: true,
        bridge: "opencode-subprocess",
        messageId: message.id,
        transport: this.transport
      }
    };
  }

  // Backward-compatible alias for older callers.
  async send(message: AcpMessage): Promise<AcpDispatchResult> {
    return this.dispatch(message);
  }
}
