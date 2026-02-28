import { A2AAcpTransport } from "../protocols/acp-a2a.js";
import { OpenCodeAcpTransport } from "../protocols/acp-opencode.js";
import { AcpMesh } from "../protocols/acp-mesh.js";
import { callSalaciaMcpTool } from "../protocols/mcp.js";

export type CoordinationProtocol = "none" | "mcp" | "acp-a2a" | "acp-opencode" | "acp-mesh";
export type CoordinationPhase = "pre-exec" | "post-exec";

const COORDINATION_PROTOCOLS: CoordinationProtocol[] = ["none", "mcp", "acp-a2a", "acp-opencode", "acp-mesh"];

export interface CoordinationDispatchResult {
  protocol: CoordinationProtocol;
  phase: CoordinationPhase;
  attempted: boolean;
  ok: boolean;
  details: string;
  response?: Record<string, unknown>;
}

export interface CoordinationDispatchOptions {
  protocol: CoordinationProtocol;
  phase: CoordinationPhase;
  cwd: string;
  adapterName: string;
  contractId: string;
  stepCount: number;
  mcpCommand?: {
    command: string;
    args: string[];
  };
  payload?: Record<string, unknown>;
}

export function isCoordinationProtocol(value: string): value is CoordinationProtocol {
  return COORDINATION_PROTOCOLS.includes(value as CoordinationProtocol);
}

function defaultMcpCommand(): { command: string; args: string[] } {
  const entry = process.argv[1];
  if (entry && entry.trim().length > 0) {
    return {
      command: process.execPath,
      args: [entry, "mcp-server"]
    };
  }
  return {
    command: process.execPath,
    args: ["dist/cli/index.js", "mcp-server"]
  };
}

function createAcpMessage(options: CoordinationDispatchOptions) {
  return {
    id: `${options.phase}-${Date.now()}`,
    type: `execution.${options.phase}`,
    source: "salacia.execute",
    target: options.adapterName,
    createdAt: new Date().toISOString(),
    payload: {
      contractId: options.contractId,
      adapter: options.adapterName,
      stepCount: options.stepCount,
      ...(options.payload ?? {})
    }
  };
}

export async function dispatchExecutionCoordination(
  options: CoordinationDispatchOptions
): Promise<CoordinationDispatchResult> {
  if (options.protocol === "none") {
    return {
      protocol: "none",
      phase: options.phase,
      attempted: false,
      ok: true,
      details: "coordination protocol disabled"
    };
  }

  if (options.protocol === "acp-a2a") {
    const dispatcher = new A2AAcpTransport();
    const result = await dispatcher.dispatch(createAcpMessage(options));
    return {
      protocol: "acp-a2a",
      phase: options.phase,
      attempted: true,
      ok: result.ok,
      details: result.details,
      ...(result.response ? { response: result.response } : {})
    };
  }

  if (options.protocol === "acp-opencode") {
    const bridge = new OpenCodeAcpTransport();
    const result = await bridge.dispatch(createAcpMessage(options));
    return {
      protocol: "acp-opencode",
      phase: options.phase,
      attempted: true,
      ok: result.ok,
      details: result.details,
      ...(result.response ? { response: result.response } : {})
    };
  }

  if (options.protocol === "acp-mesh") {
    const mesh = new AcpMesh();
    const result = await mesh.dispatch(createAcpMessage(options), "first-success");
    return {
      protocol: "acp-mesh",
      phase: options.phase,
      attempted: true,
      ok: result.ok,
      details: result.attempts.map((item) => `${item.channel}:${item.ok ? "ok" : "fail"}`).join(", "),
      response: {
        mode: result.mode,
        attempts: result.attempts
      }
    };
  }

  const mcpCommand = options.mcpCommand ?? defaultMcpCommand();
  const result = await callSalaciaMcpTool({
    command: mcpCommand.command,
    args: mcpCommand.args,
    toolName: "salacia-snapshot",
    toolArgs: {
      label: `coord-${options.phase}`
    },
    cwd: options.cwd
  });

  return {
    protocol: "mcp",
    phase: options.phase,
    attempted: true,
    ok: result.ok,
    details: result.output.slice(0, 500)
  };
}
