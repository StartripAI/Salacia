import type { AcpDispatchResult, AcpMessage } from "./acp.js";
import { A2AAcpTransport } from "./acp-a2a.js";
import { OpenCodeAcpTransport } from "./acp-opencode.js";

export type AcpMeshChannel = "a2a" | "opencode";
export type AcpMeshMode = "first-success" | "broadcast-aggregate" | "broadcast";

export interface AcpMeshRoute {
  channel: AcpMeshChannel;
  required: boolean;
}

export interface AcpMeshDispatchSummary {
  ok: boolean;
  mode: AcpMeshMode;
  attempts: Array<{
    channel: AcpMeshChannel;
    ok: boolean;
    details: string;
    response?: Record<string, unknown>;
  }>;
}

const DEFAULT_ROUTES: AcpMeshRoute[] = [
  { channel: "a2a", required: false },
  { channel: "opencode", required: false }
];

export class AcpMesh {
  private readonly a2a = new A2AAcpTransport();
  private readonly opencode = new OpenCodeAcpTransport();

  constructor(private readonly routes: AcpMeshRoute[] = DEFAULT_ROUTES) {}

  private async dispatchViaChannel(channel: AcpMeshChannel, message: AcpMessage): Promise<AcpDispatchResult> {
    if (channel === "a2a") {
      return this.a2a.dispatch(message);
    }
    return this.opencode.send(message);
  }

  async dispatch(message: AcpMessage, mode: AcpMeshMode = "first-success"): Promise<AcpMeshDispatchSummary> {
    const attempts: AcpMeshDispatchSummary["attempts"] = [];
    const normalizedMode = mode === "broadcast" ? "broadcast-aggregate" : mode;

    if (normalizedMode === "first-success") {
      for (const route of this.routes) {
        const result = await this.dispatchViaChannel(route.channel, message);
        attempts.push({
          channel: route.channel,
          ok: result.ok,
          details: result.details,
          ...(result.response ? { response: result.response } : {})
        });

        if (result.ok) {
          return {
            ok: true,
            mode: normalizedMode,
            attempts
          };
        }

        if (route.required) {
          return {
            ok: false,
            mode: normalizedMode,
            attempts
          };
        }
      }

      return {
        ok: false,
        mode: normalizedMode,
        attempts
      };
    }

    let overallOk = true;
    for (const route of this.routes) {
      const result = await this.dispatchViaChannel(route.channel, message);
      attempts.push({
        channel: route.channel,
        ok: result.ok,
        details: result.details,
        ...(result.response ? { response: result.response } : {})
      });
      if (!result.ok && route.required) {
        overallOk = false;
      }
    }

    return {
      ok: overallOk,
      mode: normalizedMode,
      attempts
    };
  }
}
